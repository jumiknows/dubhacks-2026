"""Checkout money and stale-cart regressions using private in-memory fixtures."""

from __future__ import annotations

import json
from decimal import Decimal
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from api import checkout
from api.guard import mandates
from api.schemas import CartItem, IntentMandate, Merchant, Product
from api.sessions import Session
from api.store import Store


@pytest.fixture
def context(monkeypatch):
    products = {}
    for pid, price in [("a", 0.10), ("b", 0.20), ("p", 28.0)]:
        products[pid] = Product(
            id=pid, title=f"Fixture {pid}", brand="Fixture", price=price,
            image="/static/products/fixture.svg", subcategory="moisturizer", attributes={},
            rating_listed=4, review_count=30, summary="Private checkout fixture", merchant_id="approved",
        )
    store = Store(products=products, merchants={
        "approved": Merchant(id="approved", name="Fixture Shop", verified=True),
        "other": Merchant(id="other", name="Other Fixture Shop", verified=True),
    })
    settings = SimpleNamespace(session_spend_cap=150.0, demo_server_signing=False)
    monkeypatch.setattr(checkout, "store", store)
    monkeypatch.setattr(checkout, "get_settings", lambda: settings)
    key = ec.generate_private_key(ec.SECP256R1())
    session = Session(id="fixture-session")
    session.public_key_jwk = mandates.jwk_from_public_key(key.public_key())
    session.intent_mandate = IntentMandate(
        session_id=session.id, budget_max=100, categories=["moisturizer"],
        issued_at="2026-10-17T00:00:00Z",
    )
    session.mandate_id = "fixture-mandate"
    return SimpleNamespace(store=store, settings=settings, session=session, key=key)


def _stage(context, product_id="p", quantity=1):
    action = checkout.stage(context.session, product_id, quantity)
    assert action.action == "stage_checkout"
    return action


def _authorize(context, action):
    signature = mandates.sign_raw(context.key, action.cart_payload)
    return checkout.authorize(context.session, action.cart.cart_hash, signature)


def _forbid_payment(*args, **kwargs):
    raise AssertionError("Rejected carts must not reach payment-intent creation")


def test_cart_total_is_exact_and_preserves_numeric_json_contract(context):
    items = [
        CartItem(product_id="a", title="Fixture a", merchant_id="approved", unit_price=0.1, quantity=3),
        CartItem(product_id="b", title="Fixture b", merchant_id="approved", unit_price=0.2, quantity=1),
    ]
    cart, payload = checkout.build_cart_payload(context.session, items)
    body = json.loads(payload)

    assert cart.total == 0.5 and body["total"] == 0.5
    assert isinstance(body["total"], float)
    assert isinstance(body["items"][0]["unit_price"], float)


def test_repeated_mock_authorizations_add_exact_cents_and_reject_replay(context):
    first = _stage(context, "a")
    result_a = _authorize(context, first)
    second = _stage(context, "b")
    result_b = _authorize(context, second)

    assert result_a.amount == 10 and result_b.amount == 20
    assert result_a.mock is True and result_b.mock is True
    assert context.session.spent == 0.3
    assert isinstance(context.session.spent, float)
    with pytest.raises(checkout.CheckoutError) as exc:
        _authorize(context, second)
    assert exc.value.status == 409


def test_exact_session_spend_boundary_is_allowed_and_next_cent_is_refused(context):
    context.settings.session_spend_cap = 0.30
    _authorize(context, _stage(context, "a"))
    _authorize(context, _stage(context, "b"))
    refused = checkout.stage(context.session, "a", 1)

    assert context.session.spent == 0.3
    assert refused.action == "policy_refusal"
    assert [c.rule for c in refused.policy.checks if not c.passed] == ["session_spend_cap"]


@pytest.mark.parametrize("new_price", [27.99, 28.01])
def test_signed_cart_rejects_catalog_price_changes_before_payment(context, monkeypatch, new_price):
    action = _stage(context)
    context.store.products["p"].price = new_price
    monkeypatch.setattr(checkout, "create_payment_intent", _forbid_payment)

    with pytest.raises(checkout.CheckoutError) as exc:
        _authorize(context, action)

    assert exc.value.status == 409
    assert "changed" in exc.value.message
    assert context.session.spent == 0
    assert not context.session.staged[action.cart.cart_hash].paid


def test_signed_cart_rejects_changed_merchant_even_when_both_are_approved(context, monkeypatch):
    action = _stage(context)
    context.store.products["p"].merchant_id = "other"
    monkeypatch.setattr(checkout, "create_payment_intent", _forbid_payment)

    with pytest.raises(checkout.CheckoutError) as exc:
        _authorize(context, action)

    assert exc.value.status == 409
    assert context.session.spent == 0


@pytest.mark.parametrize("price", [-0.01, float("nan"), float("inf"), 0.101, True])
def test_invalid_catalog_prices_cannot_be_staged(context, price):
    context.store.products["p"].price = price

    with pytest.raises(checkout.CheckoutError) as exc:
        checkout.stage(context.session, "p", 1)

    assert exc.value.status == 400
    assert context.session.staged == {}


def test_fractional_cent_proposal_cannot_use_old_price_tolerance(context):
    with pytest.raises(checkout.CheckoutError) as exc:
        checkout.stage(context.session, "a", 1, proposed_price=0.101)

    assert exc.value.status == 400
    assert context.session.staged == {}


def test_fractional_cent_catalog_change_cannot_be_paid(context, monkeypatch):
    action = _stage(context)
    context.store.products["p"].price = 28.001
    monkeypatch.setattr(checkout, "create_payment_intent", _forbid_payment)

    with pytest.raises(checkout.CheckoutError) as exc:
        _authorize(context, action)

    assert exc.value.status == 400
    assert context.session.spent == 0


def test_total_outside_signed_payload_cannot_change_payment_amount(context, monkeypatch):
    action = _stage(context)
    context.session.staged[action.cart.cart_hash].total = 1.0
    monkeypatch.setattr(checkout, "create_payment_intent", _forbid_payment)

    with pytest.raises(checkout.CheckoutError) as exc:
        _authorize(context, action)

    assert exc.value.status == 409
    assert context.session.spent == 0


def test_cart_for_previous_signed_rules_requires_a_new_signature(context, monkeypatch):
    action = _stage(context)
    context.session.mandate_id = "replacement-fixture-mandate"
    monkeypatch.setattr(checkout, "create_payment_intent", _forbid_payment)

    with pytest.raises(checkout.CheckoutError) as exc:
        _authorize(context, action)

    assert exc.value.status == 409
    assert context.session.spent == 0


def test_spend_policy_is_rechecked_after_staging(context, monkeypatch):
    action = _stage(context)
    context.session.spent = 145.0
    monkeypatch.setattr(checkout, "create_payment_intent", _forbid_payment)

    with pytest.raises(checkout.CheckoutError) as exc:
        _authorize(context, action)

    assert exc.value.status == 403
    assert context.session.spent == 145


def test_unsigned_cart_and_changed_signature_still_fail_before_payment(context, monkeypatch):
    action = _stage(context)
    monkeypatch.setattr(checkout, "create_payment_intent", _forbid_payment)

    with pytest.raises(checkout.CheckoutError) as unsigned:
        checkout.authorize(context.session, action.cart.cart_hash, None)
    assert unsigned.value.status == 401
    signature = mandates.sign_raw(context.key, action.cart_payload + " ")
    with pytest.raises(checkout.CheckoutError) as changed:
        checkout.authorize(context.session, action.cart.cart_hash, signature)
    assert changed.value.status == 401
    assert context.session.spent == 0


def test_payment_intent_converts_decimal_cents_without_float_multiplication(context):
    context.session.intent_mandate.max_quantity = 3
    action = _stage(context, "a", quantity=3)
    assert Decimal(str(action.cart.total)) == Decimal("0.30")
    result = _authorize(context, action)
    assert result.amount == 30 and result.mock is True
