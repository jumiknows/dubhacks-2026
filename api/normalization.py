"""Source adapters for catalog dicts and the documented Node RawProduct shape.

This is a separate contract: unknown fields must not become invented Product values.
Money uses Decimal; formatting follows an explicit dot-decimal source convention.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field

from api.schemas import AttrValue, Merchant


class NormalizationError(ValueError):
    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


class Delivery(BaseModel):
    shipping_price: Decimal | None = None
    tax: Decimal | None = None
    shipping_days: int | None = None
    estimated_arrival: date | None = None
    estimate_reference_date: date | None = None


class NormalizedProduct(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    merchant_id: str | None = None
    merchant_name: str | None = None
    brand: str | None = None
    summary: str | None = None
    subcategory: str | None = None
    price: Decimal | None = None
    currency: str | None = None
    image: str | None = None
    url: str | None = None
    attributes: dict[str, AttrValue] = Field(default_factory=dict)
    dimensions: str | None = None
    in_stock: bool | None = None
    rating_listed: float | None = None
    review_count: int | None = None
    delivery: Delivery = Field(default_factory=Delivery)


def parse_amount(value: Any, currency: str | None = None) -> Decimal | None:
    """Parse nonnegative, finite amounts with at most two fractional digits.

    Supports 12.34, '1,234.56', and explicit USD '$12.34'/'USD 12.34'.
    Never infer a currency, round extra precision, or interpret decimal commas.
    The first recommendation milestone supports USD only, with no FX conversion.
    """
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise ValueError("Expected a numeric amount or dot-decimal price string.")
    text = str(value).strip()
    if text.startswith("$") or text.upper().startswith("USD ") or text.upper().endswith(" USD"):
        if currency != "USD":
            raise ValueError("USD price notation requires an explicit USD currency.")
        text = re.sub(r"^USD\s+|\s+USD$", "", text, flags=re.IGNORECASE).removeprefix("$").strip()
    if not re.fullmatch(r"(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?", text):
        raise ValueError("Expected a nonnegative dot-decimal amount with at most two decimal places.")
    try:
        amount = Decimal(text.replace(",", ""))
    except InvalidOperation as exc:
        raise ValueError("Invalid monetary amount.") from exc
    if not amount.is_finite() or amount < 0 or amount > Decimal("999999999999.99"):
        raise ValueError("Monetary amount is outside the supported range.")
    return amount


def _text(value: Any, field: str, *, required: bool = False) -> str | None:
    if value is None:
        if required:
            raise NormalizationError(field, "Required field is missing.")
        return None
    if not isinstance(value, str) or not value.strip():
        raise NormalizationError(field, "Expected a nonempty string.")
    return value.strip()


def _alias(raw: Mapping[str, Any], *names: str) -> Any:
    values = [raw[n] for n in names if raw.get(n) is not None]
    if any(type(v) is not type(values[0]) or v != values[0] for v in values[1:]):
        raise NormalizationError(names[0], "Conflicting source fields.")
    return values[0] if values else None


def _currency(value: Any) -> str | None:
    value = _text(value, "currency")
    if value is None:
        return None
    if not re.fullmatch(r"[A-Za-z]{3}", value):
        raise NormalizationError("currency", "Expected a three-letter currency code.")
    return value.upper()


def _amount(raw: Mapping[str, Any], currency: str | None, *names: str) -> Decimal | None:
    try:
        return parse_amount(_alias(raw, *names), currency)
    except NormalizationError:
        raise
    except ValueError as exc:
        raise NormalizationError(names[0], str(exc)) from exc


def _integer(value: Any, field: str) -> int | None:
    if value is None:
        return None
    if type(value) is not int or value < 0:
        raise NormalizationError(field, "Expected a nonnegative integer.")
    return value


def _source_date(value: Any, field: str) -> date | None:
    """Copy a source's explicit calendar date; never derive one from shipping duration."""
    if value is None or type(value) is date:
        return value
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise NormalizationError(field, "Expected an explicit ISO calendar date (YYYY-MM-DD).")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise NormalizationError(field, "Source calendar date is invalid.") from exc


def _url(value: Any, field: str, *, relative_image: bool = False) -> str | None:
    value = _text(value, field)
    if value is None:
        return None
    if any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in value) or "\\" in value:
        raise NormalizationError(field, "URL contains unsupported whitespace or path characters.")
    if relative_image and value.startswith("/") and not value.startswith("//"):
        return value
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError
        parsed.port  # Reject malformed ports too; HTTPS is syntax, not merchant verification.
    except ValueError as exc:
        raise NormalizationError(field, "Expected an HTTPS URL without embedded credentials.") from exc
    return value


def normalize_attributes(value: Any) -> dict[str, AttrValue]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise NormalizationError("attributes", "Expected an object of scalar attributes.")
    out: dict[str, AttrValue] = {}
    for key, v in value.items():
        if not isinstance(key, str) or not key.strip():
            raise NormalizationError("attributes", "Attribute names must be nonempty strings.")
        if v is None:  # Null means unknown; it must not satisfy a hard requirement.
            continue
        if type(v) not in (str, bool, int, float) or isinstance(v, float) and not math.isfinite(v):
            raise NormalizationError("attributes", "Attribute values must be finite scalars.")
        if key in {"fragrance_free", "hydrating"}:
            if isinstance(v, str) and v.lower().strip() in {"true", "false"}:
                v = v.lower().strip() == "true"
            if type(v) is not bool:
                raise NormalizationError("attributes", "Known boolean attributes require true or false.")
        if key in {"spf", "size_ml"}:
            try:
                v = float(parse_amount(v))
            except (ValueError, TypeError) as exc:
                raise NormalizationError("attributes", "Known numeric attributes must be nonnegative numbers.") from exc
        out[key] = v
    return out


def normalize_product(
    raw: Any, merchants: Mapping[str, Merchant], *, source_currency: str | None = None,
) -> NormalizedProduct:
    """Normalize one record without I/O, global changes, generated IDs or inferred facts."""
    if not isinstance(raw, dict):
        raise NormalizationError("product", "Expected a product object.")
    currency = _currency(raw.get("currency")) or _currency(source_currency)
    if raw.get("currency") is not None and source_currency is not None and currency != _currency(source_currency):
        raise NormalizationError("currency", "Product currency conflicts with the declared source currency.")
    for field in ("shipping_currency", "shippingCurrency", "tax_currency", "taxCurrency"):
        if raw.get(field) is not None and _currency(raw[field]) != currency:
            raise NormalizationError(field, "Charge currency conflicts with the product currency.")
    merchant_id = _text(raw.get("merchant_id"), "merchant_id")
    merchant_name = _text(raw.get("store"), "store")
    if merchant_name:
        matches = [m.id for m in merchants.values() if m.name.casefold() == merchant_name.casefold()]
        if len(matches) == 1:
            if merchant_id is not None and merchant_id != matches[0]:
                raise NormalizationError("merchant_id", "Merchant identifier conflicts with the source store name.")
            merchant_id = matches[0]
        elif merchant_id in merchants and merchants[merchant_id].name.casefold() != merchant_name.casefold():
            raise NormalizationError("merchant_id", "Merchant identifier conflicts with the source store name.")
    dimensions = raw.get("dimensions")
    if isinstance(dimensions, dict):
        dimensions = dimensions.get("label")
    stock = _alias(raw, "in_stock", "inStock")
    if stock is not None and type(stock) is not bool:
        raise NormalizationError("in_stock", "Expected a boolean stock status.")
    rating = raw.get("rating_listed")
    if rating is not None:
        if type(rating) not in (int, float) or not 0 <= rating <= 5 or not math.isfinite(rating):
            raise NormalizationError("rating_listed", "Expected a rating between zero and five.")
    delivery = Delivery(
        shipping_price=_amount(raw, currency, "shipping_price", "shippingPrice"),
        tax=_amount(raw, currency, "tax"),
        shipping_days=_integer(_alias(raw, "shipping_days", "shippingDays"), "shipping_days"),
        estimated_arrival=_source_date(_alias(raw, "estimated_arrival", "estimatedArrival"), "estimated_arrival"),
        estimate_reference_date=_source_date(
            _alias(raw, "estimate_reference_date", "estimateReferenceDate"), "estimate_reference_date",
        ),
    )
    if (delivery.estimated_arrival is not None and delivery.estimate_reference_date is not None
            and delivery.estimated_arrival < delivery.estimate_reference_date):
        raise NormalizationError("estimated_arrival", "Arrival precedes the source's estimate reference date.")
    # A duration without an agreed reference date/calendar is not an arrival date.
    return NormalizedProduct(
        id=_text(_alias(raw, "id", "product_id"), "id", required=True),
        title=_text(_alias(raw, "title", "name"), "title", required=True),
        merchant_id=merchant_id, merchant_name=merchant_name,
        brand=_text(raw.get("brand"), "brand"),
        summary=_text(_alias(raw, "summary", "description"), "summary"),
        subcategory=_text(raw.get("subcategory"), "subcategory"),
        price=_amount(raw, currency, "price"), currency=currency,
        image=_url(raw.get("image"), "image", relative_image=True), url=_url(raw.get("url"), "url"),
        attributes=normalize_attributes(raw.get("attributes")), dimensions=_text(dimensions, "dimensions"),
        in_stock=stock, rating_listed=rating,
        review_count=_integer(raw.get("review_count"), "review_count"), delivery=delivery,
    )
