"""Cart staging (propose -> policy -> sign) and payment intent creation.

The agent can reach `stage()`; nothing the agent can reach calls `create_payment_intent()`.
That only runs from POST /checkout/intent, after the user's signature verifies.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from cryptography.hazmat.primitives.asymmetric import ec

from api.config import get_settings
from api.guard import audit, mandates, policy
from api.schemas import Cart, CartItem, PolicyCheck, PolicyRefusal, PolicyResult, StageCheckout
from api.sessions import Session, StagedCart
from api.store import store
from api.websites.checkout import destination_check, destination_map


class CheckoutError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


_CENT = Decimal("0.01")
_MAX_AMOUNT = Decimal("999999999999.99")


def _amount(value: object, label: str, *, cents: bool = True) -> Decimal:
    """Validate money before arithmetic; never round an unknown fraction of a cent."""
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise CheckoutError(400, f"{label} must be a nonnegative, finite numeric amount.")
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0 or amount > _MAX_AMOUNT:
            raise ValueError
        if cents and amount != amount.quantize(_CENT):
            raise ValueError
    except (InvalidOperation, ValueError) as exc:
        raise CheckoutError(400, f"{label} must be nonnegative, finite and use at most two decimal places.") from exc
    return amount


def _quantity(value: int) -> int:
    if type(value) is not int or value < 1:
        raise CheckoutError(400, "Quantity must be a positive integer.")
    return value


def _total(items: list[CartItem]) -> Decimal:
    return sum((_amount(item.unit_price, "Unit price") * _quantity(item.quantity) for item in items), Decimal(0))


def _evaluate(session: Session, lines: list[policy.ProposedLine]) -> PolicyResult:
    """Keep existing policy checks, using exact cents for the final money limits."""
    total = Decimal(0)
    for line in lines:
        _amount(line.unit_price, "Proposed unit price")
        _quantity(line.quantity)
        product = store.product(line.product_id)
        if product is not None:
            total += _amount(product.price, "Catalog unit price") * line.quantity
    limits = _limits(session)
    spent = _amount(session.spent, "Session spend")
    budget = _amount(limits.budget_max, "Budget", cents=False)
    cap = _amount(limits.session_cap, "Session spend cap", cents=False)
    result = policy.evaluate(lines, store.products, store.merchants, limits, session.spent)
    source = "your signed rules" if limits.from_mandate else "safe defaults (no signed rules yet)"
    replacements = {
        "within_budget": PolicyCheck(
            rule="within_budget", passed=total <= budget,
            reason=(f"Total ${total:,.2f} is within the ${budget:,.2f} budget from {source}."
                    if total <= budget else f"Total ${total:,.2f} is over the ${budget:,.2f} budget from {source}."),
        ),
        "session_spend_cap": PolicyCheck(
            rule="session_spend_cap", passed=spent + total <= cap,
            reason=(f"Session spend would be ${spent + total:,.2f} of the ${cap:,.2f} cap."
                    if spent + total <= cap else f"Session spend would reach ${spent + total:,.2f}, over the ${cap:,.2f} cap."),
        ),
    }
    checks = [replacements.get(check.rule, check) for check in result.checks]
    for merchant_id in sorted({p.merchant_id for line in lines if (p := store.product(line.product_id)) is not None}):
        checks.append(destination_check(merchant_id))
    return PolicyResult(allowed=all(check.passed for check in checks), checks=checks)


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _limits(session: Session) -> policy.Limits:
    return policy.limits_for(session.intent_mandate, get_settings().session_spend_cap)


def build_cart_payload(session: Session, items: list[CartItem]) -> tuple[Cart, str]:
    """Canonical JSON (sorted keys, no spaces) built only from server-side catalog data.
    cart_hash = sha256(canonical body); cart_payload = canonical(body + cart_hash)."""
    # Keep the public numeric JSON schema; all arithmetic happens in Decimal first.
    total = float(_amount(_total(items), "Cart total"))
    body = {
        "session_id": session.id,
        "mandate_id": session.mandate_id,
        "items": [i.model_dump() for i in items],
        "total": total,
        "currency": "usd",
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "nonce": secrets.token_hex(8),
    }
    destinations = destination_map(item.merchant_id for item in items)
    if destinations:
        body["merchant_destinations"] = destinations
    cart_hash = _sha256(audit.canonical(body))
    payload = audit.canonical({**body, "cart_hash": cart_hash})
    return Cart(items=items, total=total, cart_hash=cart_hash), payload


def stage(session: Session, product_id: str, quantity: int, proposed_price: float | None = None) -> StageCheckout | PolicyRefusal:
    p = store.product(product_id)
    line = policy.ProposedLine(
        product_id=product_id,
        unit_price=proposed_price if proposed_price is not None else (p.price if p else 0.0),
        quantity=quantity,
    )
    result = _evaluate(session, [line])
    audit.append(session.audit, "proposal", {"product_id": product_id, "quantity": quantity, "proposed_price": line.unit_price})
    audit.append(session.audit, "policy_result", result.model_dump())
    if not result.allowed or p is None:
        return PolicyRefusal(policy=result)

    item = CartItem(product_id=p.id, title=p.title, merchant_id=p.merchant_id, unit_price=p.price, quantity=quantity)
    cart, payload = build_cart_payload(session, [item])
    session.staged[cart.cart_hash] = StagedCart(cart.cart_hash, payload, cart.total, p.id)
    audit.append(session.audit, "cart_staged", {"cart_hash": cart.cart_hash, "total": cart.total})
    return StageCheckout(product_id=p.id, cart=cart, cart_payload=payload, policy=result)


def _demo_sign(session: Session, payload: str) -> tuple[str, dict[str, str]]:
    if session.demo_private_key is None:
        session.demo_private_key = ec.generate_private_key(ec.SECP256R1())
    key: ec.EllipticCurvePrivateKey = session.demo_private_key  # type: ignore[assignment]
    return mandates.sign_raw(key, payload), mandates.jwk_from_public_key(key.public_key())


def _payload_hash_ok(staged: StagedCart) -> bool:
    try:
        body = json.loads(staged.cart_payload)
        claimed = body.pop("cart_hash", None)
        return claimed == staged.cart_hash == _sha256(audit.canonical(body))
    except (TypeError, ValueError, AttributeError):
        return False


@dataclass
class PaymentIntentResult:
    client_secret: str
    payment_intent_id: str
    amount: int
    currency: str
    cart_hash: str
    mock: bool

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def authorize(session: Session, cart_hash: str, signature: str | None) -> PaymentIntentResult:
    staged = session.staged.get(cart_hash)
    if staged is None:
        raise CheckoutError(409, "No staged cart with that hash in this session.")
    if staged.paid:
        audit.append(session.audit, "replay_rejected", {"cart_hash": cart_hash})
        raise CheckoutError(409, "This cart has already been paid.")
    if not _payload_hash_ok(staged):
        raise CheckoutError(409, "Staged cart failed its integrity check.")

    settings = get_settings()
    if signature is None:
        if not settings.demo_server_signing:
            raise CheckoutError(401, "A signature over cart_payload is required.")
        signature, jwk = _demo_sign(session, staged.cart_payload)
        audit.append(session.audit, "demo_server_signed", {"cart_hash": cart_hash, "warning": "DEMO_SERVER_SIGNING is on"})
    else:
        if session.public_key_jwk is None:
            raise CheckoutError(401, "Register an intent mandate (with your public key) before paying.")
        jwk = session.public_key_jwk

    try:
        ok = mandates.verify_signature(jwk, staged.cart_payload, signature)
    except mandates.MandateError as exc:
        raise CheckoutError(401, str(exc)) from exc
    if not ok:
        audit.append(session.audit, "signature_rejected", {"cart_hash": cart_hash})
        raise CheckoutError(401, "Signature does not match the staged cart.")
    audit.append(session.audit, "cart_signed", {"cart_hash": cart_hash, "signature": signature})

    # Compare the exact signed line to the current listing before policy or payment.
    # In particular, do not compare the current price against itself here.
    body = json.loads(staged.cart_payload, parse_float=Decimal)
    if body.get("session_id") != session.id or body.get("mandate_id") != session.mandate_id or body.get("currency") != "usd":
        raise CheckoutError(409, "Staged cart no longer matches this session's signed rules or currency.")
    items = body.get("items", [])
    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict) or items[0].get("product_id") != staged.product_id:
        raise CheckoutError(409, "Staged cart no longer matches its signed product.")
    signed_item = items[0]
    expected_destinations = destination_map([signed_item.get("merchant_id", "")])
    if body.get("merchant_destinations", {}) != expected_destinations:
        audit.append(session.audit, "checkout_destination_changed", {"cart_hash": cart_hash})
        raise CheckoutError(409, "Checkout destination changed; review and sign a new cart.")
    signed_price = _amount(signed_item.get("unit_price"), "Signed unit price")
    qty = _quantity(signed_item.get("quantity"))
    signed_total = signed_price * qty
    if signed_total != _amount(body.get("total"), "Signed total") or signed_total != _amount(staged.total, "Staged total"):
        raise CheckoutError(409, "Staged total does not match the signed cart.")
    p = store.product(staged.product_id)
    if p is not None and (
        _amount(p.price, "Catalog unit price") != signed_price
        or p.merchant_id != signed_item.get("merchant_id")
    ):
        audit.append(session.audit, "stale_cart_rejected", {"cart_hash": cart_hash})
        raise CheckoutError(409, "Catalog price or merchant changed; review and sign a new cart.")
    # Re-check policy at payment time: spend or signed restrictions may have changed.
    recheck = _evaluate(session, [policy.ProposedLine(staged.product_id, float(signed_price), qty)])
    if not recheck.allowed:
        audit.append(session.audit, "policy_result", recheck.model_dump())
        raise CheckoutError(403, "Cart no longer passes policy: " + "; ".join(c.reason for c in recheck.checks if not c.passed))

    result = create_payment_intent(session, staged)
    staged.paid = True
    session.spent = float(_amount(session.spent, "Session spend") + signed_total)
    audit.append(session.audit, "payment_intent_created", {
        "cart_hash": cart_hash, "payment_intent_id": result.payment_intent_id, "amount": result.amount, "mock": result.mock,
    })
    return result


def create_payment_intent(session: Session, staged: StagedCart) -> PaymentIntentResult:
    amount = int(_amount(staged.total, "Staged total") * 100)
    # Phase 3: Stripe test mode. For now, a clearly labeled mock.
    pid = "pi_mock_" + staged.cart_hash[:16]
    return PaymentIntentResult(
        client_secret=f"{pid}_secret_MOCK_NOT_A_REAL_PAYMENT", payment_intent_id=pid,
        amount=amount, currency="usd", cart_hash=staged.cart_hash, mock=True,
    )
