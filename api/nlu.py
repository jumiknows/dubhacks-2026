"""Deterministic parsing of shopping requests. Shared by search and the fallback agent."""

from __future__ import annotations

import re
import math
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Protocol

from api.schemas import AttrValue


class AttributedProduct(Protocol):
    attributes: dict[str, AttrValue]


SKIN_TYPES = ("dry", "oily", "combination", "sensitive", "normal")

_SUBCATEGORIES: list[tuple[str, re.Pattern[str]]] = [
    ("cleanser", re.compile(r"\b(cleansers?|face ?wash|wash)\b")),
    ("sunscreen", re.compile(r"\b(sunscreens?|sun ?screens?|sunblock|spf)\b")),
    ("serum", re.compile(r"\bserums?\b")),
    ("moisturizer", re.compile(r"\b(moisturi[sz]ers?|moisturi[sz]ing cream|face cream|cream|lotion)\b")),
]

# need -> (pattern, human label)
_NEEDS: dict[str, tuple[re.Pattern[str], str]] = {
    "hydrating": (re.compile(r"\b(hydrat\w*|moisture|plump\w*)\b"), "hydrating"),
    "spf": (re.compile(r"\b(spf|sun protection|uv)\b"), "SPF"),
    "brightening": (re.compile(r"\b(brighten\w*|dark spots?|glow\w*)\b"), "brightening"),
    "gentle": (re.compile(r"\b(gentle|mild|calm\w*|sooth\w*)\b"), "gentle"),
    "acne": (re.compile(r"\b(acne|breakouts?|blemish\w*|pimples?|clogged pores)\b"), "acne-prone skin"),
}

_FRAGRANCE_FREE = re.compile(r"\b(fragrance[- ]?free|unscented|no fragrance|without fragrance|scent[- ]?free)\b")
_HAS_FRAGRANCE = re.compile(
    r"\b(has|have|with|contains?|smells?|got)\b.{0,20}\b(fragrance|scent|perfume)"
    r"|\b(fragranced|perfumed|scented)\b"
    r"|\b(hate|dislike|don'?t like|can'?t stand|too strong|too much)\b.{0,20}\b(smell|scent|fragrance|perfume)\b"
    r"|\bsmells? (bad|weird|strong|awful|too strong)\b"
)
_BUDGET_PREFIX = re.compile(
    r"(?:\b(?:under|below|less than|cheaper than|max(?:imum)?|up to|at most|no more than)(?![a-z])|<)\s*",
    re.IGNORECASE,
)
_CURRENCY_CODES = (
    "USD EUR GBP JPY CNY CAD AUD NZD CHF HKD SGD INR KRW RUB BRL MXN ZAR SEK NOK DKK PLN CZK "
    "HUF RON BGN TRY ILS AED SAR QAR KWD BHD OMR JOD EGP MAD NGN KES PKR BDT LKR NPR THB "
    "VND IDR MYR PHP TWD UAH ARS CLP COP PEN UYU ISK RSD GEL KZT"
).split()
_CURRENCY = r"(?:US\$|CA\$|C\$|AU\$|A\$|NZ\$|HK\$|S\$|[$€£¥₹₩₽₺₱₪₫฿]|(?<![a-z])(?:" + "|".join(_CURRENCY_CODES) + r")(?![a-z]))"
_AMOUNT = r"[+-]?(?:\d[\d,._]*(?:[eE][+-]?\d+)?|\.\d[\d,._]*)"
_MONEY = re.compile(
    rf"(?P<prefix>{_CURRENCY})?\s*(?P<amount>{_AMOUNT})(?P<suffix>\s*(?:{_CURRENCY}|US dollars?\b|dollars?\b|euros?\b|pounds?\b))?",
    re.IGNORECASE,
)
_BUDGET_SUFFIX = re.compile(r"\s+(?:or less|max|tops|budget)\b", re.IGNORECASE)
_VALID_AMOUNT = re.compile(r"(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?")
_MONETARY_START = re.compile(
    rf"(?:[+-]?\s*{_CURRENCY}|[+-]?\s*(?:\d|\.\d)|(?:nan|inf(?:inity)?)(?![a-z]))",
    re.IGNORECASE,
)
_FRAGRANCE_FREE_WORDS = {"fragrance_free", "fragrancefree", "unscented", "no_fragrance", "scent_free", "without_fragrance"}


def _preference_key(value: str) -> str:
    return re.sub(r"[\s_-]+", "_", value.strip().lower())


def normalize_preferences(needs: list[str], avoid: list[str]) -> tuple[list[str], list[str]]:
    """Canonicalize preferences without dropping later safety restrictions."""
    out_needs, out_avoid = [], []
    for value in needs:
        key = _preference_key(value)
        if key in _FRAGRANCE_FREE_WORDS:
            out_avoid.append("fragrance")
        elif key:
            out_needs.append({"hydration": "hydrating", "moisturizing": "hydrating", "moisture": "hydrating",
                              "sun_protection": "spf", "sunscreen": "spf", "uv": "spf"}.get(key, key))
    for value in avoid:
        key = _preference_key(value)
        if key:
            out_avoid.append("fragrance" if key in {"fragrance", "fragrances", "scent", "perfume"}
                             else key.replace("_", " "))
    return list(dict.fromkeys(out_needs)), list(dict.fromkeys(out_avoid))


def _budget(text: str) -> tuple[float | None, str | None]:
    """Recognize whole USD amounts, never a numeric prefix of malformed/foreign money."""
    candidates = []
    for prefix in _BUDGET_PREFIX.finditer(text):
        candidates.append((prefix.end(), True))
    # Trailing budget phrases require an explicit money marker, so SPF 50 is not money.
    for money in _MONEY.finditer(text):
        markers = [v.strip().upper() for v in (money.group("prefix"), money.group("suffix")) if v]
        if any(marker not in {"USD", "$", "US$", "DOLLAR", "DOLLARS", "US DOLLAR", "US DOLLARS"} for marker in markers):
            return None, "This catalog uses USD; currency conversion is unavailable. Please provide a USD budget."
        if (money.group("prefix") or money.group("suffix")) and _BUDGET_SUFFIX.match(text, money.end()):
            candidates.append((money.start(), False))
    budgets = []
    for start, required in candidates:
        match = _MONEY.match(text, start)
        if match is None:
            # "under-eye", "under my eyes" and "maximum SPF 50" describe products,
            # not money. A malformed explicit money marker must still be clarified.
            if required and _MONETARY_START.match(text, start):
                return None, "Please specify a valid USD budget; other currencies cannot be converted."
            continue
        amount_text = match.group("amount")
        rest = text[match.end():]
        # A single trailing sentence mark is punctuation; spaced numeric grouping is not.
        if amount_text[-1:] in {",", "."} and (not rest or rest[0].isspace()) and not re.match(r"\s*\d", rest):
            amount_text = amount_text[:-1]
        if (rest and (rest[0].isalnum() or rest[0] in ". ,_+-/".replace(" ", ""))
                or re.match(r"\s+\d", rest)):
            return None, "Please specify one nonnegative USD amount with valid comma grouping and at most two decimal places."
        markers = [v.strip().upper() for v in (match.group("prefix"), match.group("suffix")) if v]
        if any(marker not in {"USD", "$", "US$", "DOLLAR", "DOLLARS", "US DOLLAR", "US DOLLARS"} for marker in markers):
            return None, "This catalog uses USD; currency conversion is unavailable. Please provide a USD budget."
        if not _VALID_AMOUNT.fullmatch(amount_text):
            return None, "Please specify one nonnegative USD amount with valid comma grouping and at most two decimal places."
        amount = Decimal(amount_text.replace(",", ""))
        if amount > 10_000:
            return None, "This demo supports USD budgets up to $10,000. Please provide a supported budget."
        budgets.append(float(amount))
    return (min(budgets) if budgets else None), None


@dataclass
class ParsedQuery:
    text: str
    budget_max: float | None = None
    skin_types: list[str] = field(default_factory=list)
    needs: list[str] = field(default_factory=list)
    avoid: list[str] = field(default_factory=list)
    subcategory: str | None = None
    budget_error: str | None = None

    @property
    def has_shopping_terms(self) -> bool:
        return bool(self.budget_error or self.budget_max is not None or self.skin_types or self.needs or self.avoid or self.subcategory)


def parse(text: str) -> ParsedQuery:
    t = text.lower()
    q = ParsedQuery(text=text)
    q.budget_max, q.budget_error = _budget(text)
    q.skin_types = [s for s in SKIN_TYPES if re.search(rf"\b{s}\b", t)]
    q.needs = [k for k, (rx, _) in _NEEDS.items() if rx.search(t)]
    if _FRAGRANCE_FREE.search(t):
        q.avoid.append("fragrance")
    q.subcategory = next((name for name, rx in _SUBCATEGORIES if rx.search(t)), None)
    if q.subcategory == "sunscreen" and "spf" not in q.needs:
        q.needs.append("spf")
    return q


def mentions_fragrance_problem(text: str) -> bool:
    return bool(_HAS_FRAGRANCE.search(text.lower())) and not _FRAGRANCE_FREE.search(text.lower())


def need_label(need: str) -> str:
    return _NEEDS[need][1] if need in _NEEDS else need.replace("_", " ")


def product_skin_types(p: AttributedProduct) -> list[str]:
    return [s.strip().lower() for s in str(p.attributes.get("skin_type", "")).split(",") if s.strip()]


def meets_need(p: AttributedProduct, need: str) -> bool:
    normalized, avoided = normalize_preferences([need], [])
    if "fragrance" in avoided:
        return p.attributes.get("fragrance_free") is True
    need = normalized[0] if normalized else ""
    a = p.attributes
    if need == "hydrating":
        return a.get("hydrating") is True
    if need == "spf":
        try:
            spf = float(a.get("spf", 0) or 0)
            return type(a.get("spf")) is not bool and math.isfinite(spf) and spf > 0
        except (TypeError, ValueError, OverflowError):
            return False
    if need == "brightening":
        return str(a.get("key_ingredient", "")) in ("vitamin c", "niacinamide")
    if need == "gentle":
        return "sensitive" in product_skin_types(p) or a.get("fragrance_free") is True
    if need == "acne":
        return str(a.get("key_ingredient", "")) in ("salicylic acid", "niacinamide") or "oily" in product_skin_types(p)
    if need == "fragrance_free":
        return a.get("fragrance_free") is True
    return False


def violates_avoid(p: AttributedProduct, avoid: str) -> bool:
    _, normalized = normalize_preferences([], [avoid])
    if not normalized:
        return False
    avoid = normalized[0]
    if avoid == "fragrance":
        return p.attributes.get("fragrance_free") is not True
    ingredient = re.sub(r"[\s_-]+", " ", str(p.attributes.get("key_ingredient", "")).lower())
    return avoid in ingredient
