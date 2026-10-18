"""Local synthetic input examples; these do not represent fetched offers."""

from decimal import Decimal

import pytest

from api.normalization import NormalizationError, normalize_product, parse_amount
from api.schemas import Merchant


@pytest.fixture
def merchants():
    return {"test-shop": Merchant(id="test-shop", name="Test Shop", verified=True)}


@pytest.fixture
def raw_product():
    # Matches server/services/fetchBot.js's documented RawProduct, with local test values.
    return {
        "id": "fixture-1", "store": "Test Shop", "title": "Synthetic test cream",
        "price": "$12.34", "currency": "USD", "image": None,
        "url": "https://shop.example/products/test", "dimensions": {"label": "50 ml"},
        "shippingDays": 3, "inStock": True,
    }


def test_normalizes_node_shape_without_inventing_metadata(raw_product, merchants):
    p = normalize_product(raw_product, merchants)
    assert (p.id, p.merchant_id, p.price, p.currency) == ("fixture-1", "test-shop", Decimal("12.34"), "USD")
    assert p.dimensions == "50 ml" and p.in_stock is True
    assert p.delivery.shipping_days == 3
    assert p.delivery.estimated_arrival is None and p.delivery.estimate_reference_date is None
    assert p.brand is None and p.rating_listed is None and p.review_count is None
    assert p.image is None and p.summary is None and p.attributes == {}
    assert raw_product["price"] == "$12.34"  # No source mutation.


def test_catalog_adapter_requires_explicit_source_currency(merchants):
    raw = {
        "id": "fixture-2", "title": "Synthetic catalog cream", "brand": "Test Brand", "price": 12.34,
        "image": "/static/products/test.svg", "subcategory": "moisturizer", "summary": "Local fixture",
        "attributes": {"fragrance_free": "false", "hydrating": "true", "spf": "30"},
        "rating_listed": 4.2, "review_count": 35, "merchant_id": "test-shop",
    }
    assert normalize_product(raw, merchants).currency is None
    p = normalize_product(raw, merchants, source_currency="USD")
    assert p.currency == "USD" and p.attributes == {"fragrance_free": False, "hydrating": True, "spf": 30.0}
    assert p.rating_listed == 4.2 and p.review_count == 35


@pytest.mark.parametrize("value,expected", [
    (0, "0"), (12, "12"), (12.34, "12.34"), (Decimal("0.10"), "0.10"),
    ("1,234.56", "1234.56"), ("USD 12.34", "12.34"), ("12.34 USD", "12.34"), ("$12.34", "12.34"),
])
def test_valid_prices(value, expected):
    assert parse_amount(value, "USD") == Decimal(expected)


@pytest.mark.parametrize("value", [
    -1, "-1.00", True, False, float("nan"), float("inf"), Decimal("NaN"),
    "free", "", "12,34", "1.234,56", "12.345", "1e3", [], {}, "10 or 20", "€10.00",
])
def test_rejects_invalid_negative_nonfinite_or_ambiguous_prices(value):
    with pytest.raises(ValueError):
        parse_amount(value, "USD")


def test_missing_price_and_delivery_remain_unknown(merchants):
    p = normalize_product({"id": "fixture-3", "title": "Unpriced fixture"}, merchants)
    assert p.price is None and p.currency is None
    assert p.delivery.shipping_price is None and p.delivery.tax is None
    assert p.delivery.shipping_days is None and p.delivery.estimated_arrival is None


def test_shipping_and_tax_stay_distinct_and_exact(raw_product, merchants):
    raw_product.update(price="0.10", shipping_price="0.20", tax="0.03")
    p = normalize_product(raw_product, merchants)
    assert p.price + p.delivery.shipping_price + p.delivery.tax == Decimal("0.33")


@pytest.mark.parametrize("field", ["id", "title"])
def test_missing_required_identifiers(raw_product, merchants, field):
    del raw_product[field]
    with pytest.raises(NormalizationError) as exc:
        normalize_product(raw_product, merchants)
    assert exc.value.field == field


@pytest.mark.parametrize("raw", [None, [], "product", 12, {"id": [], "title": "Test"}, {"id": "a", "title": 2}])
def test_malformed_product_data(raw, merchants):
    with pytest.raises(NormalizationError):
        normalize_product(raw, merchants)


@pytest.mark.parametrize("overrides", [
    {"name": "Conflicting name"}, {"product_id": "different-id"},
    {"merchant_id": "another-shop"}, {"currency": "not-a-currency"},
    {"rating_listed": 6}, {"rating_listed": 10**400}, {"rating_listed": True}, {"review_count": -1},
    {"inStock": "false"}, {"shippingDays": -1}, {"shippingDays": 1.5},
    {"attributes": []}, {"attributes": {"fragrance_free": 1}},
    {"attributes": {"nested": {"value": True}}}, {"attributes": {"spf": "unknown"}},
    {"attributes": {"value": float("nan")}},
])
def test_conflicting_and_invalid_fields_are_rejected(raw_product, merchants, overrides):
    with pytest.raises(NormalizationError):
        normalize_product({**raw_product, **overrides}, merchants)


def test_currency_conflicts_are_rejected(raw_product, merchants):
    with pytest.raises(NormalizationError):
        normalize_product(raw_product, merchants, source_currency="EUR")
    with pytest.raises(NormalizationError):
        normalize_product({**raw_product, "currency": "EUR"}, merchants)
    with pytest.raises(ValueError):
        parse_amount("$12.34")


def test_charge_currency_conflicts_are_rejected(raw_product, merchants):
    with pytest.raises(NormalizationError) as exc:
        normalize_product({**raw_product, "shippingPrice": "2.00", "shippingCurrency": "EUR"}, merchants)
    assert exc.value.field == "shippingCurrency"


@pytest.mark.parametrize("url", [
    "javascript:alert(1)", "http://shop.example/test", "https://user:password@shop.example/test",
    "https:///missing-host", "https://shop.example:bad/test", "//shop.example/test",
])
def test_unsafe_url_syntax_is_rejected(raw_product, merchants, url):
    with pytest.raises(NormalizationError) as exc:
        normalize_product({**raw_product, "url": url}, merchants)
    assert exc.value.field == "url"


def test_unknown_attributes_and_merchants_are_not_inferred(raw_product, merchants):
    p = normalize_product({**raw_product, "store": "Unknown Shop", "attributes": {"hydrating": None}}, merchants)
    assert p.merchant_id is None and p.merchant_name == "Unknown Shop"
    assert "hydrating" not in p.attributes


@pytest.mark.parametrize("image", ["/\\evil.example/test", "/bad path", "/bad\x00path", "//evil.example/test"])
def test_relative_images_reject_unsafe_path_characters(raw_product, merchants, image):
    with pytest.raises(NormalizationError):
        normalize_product({**raw_product, "image": image}, merchants)


def test_money_serializes_as_decimal_strings(raw_product, merchants):
    p = normalize_product(raw_product, merchants)
    assert p.model_dump(mode="json")["price"] == "12.34"
