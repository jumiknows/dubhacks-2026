"""Deterministic parsing of shopping requests. Shared by search and the fallback agent."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from api.schemas import Product

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
}

_FRAGRANCE_FREE = re.compile(r"\b(fragrance[- ]?free|unscented|no fragrance|without fragrance|scent[- ]?free)\b")
_HAS_FRAGRANCE = re.compile(r"\b(has|have|with|contains?|smells?|got)\b.{0,20}\b(fragrance|scent|perfume)|\b(fragranced|perfumed|scented)\b")
_BUDGET = re.compile(
    r"(?:under|below|less than|cheaper than|max(?:imum)?|up to|at most|<|no more than)\s*\$?\s*(\d+(?:\.\d+)?)"
    r"|\$\s*(\d+(?:\.\d+)?)\s*(?:or less|max|tops|budget)"
)


@dataclass
class ParsedQuery:
    text: str
    budget_max: float | None = None
    skin_types: list[str] = field(default_factory=list)
    needs: list[str] = field(default_factory=list)
    avoid: list[str] = field(default_factory=list)
    subcategory: str | None = None

    @property
    def has_shopping_terms(self) -> bool:
        return bool(self.budget_max or self.skin_types or self.needs or self.avoid or self.subcategory)


def parse(text: str) -> ParsedQuery:
    t = text.lower()
    q = ParsedQuery(text=text)
    m = _BUDGET.search(t)
    if m:
        q.budget_max = float(m.group(1) or m.group(2))
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


def product_skin_types(p: Product) -> list[str]:
    return [s.strip() for s in str(p.attributes.get("skin_type", "")).split(",") if s.strip()]


def meets_need(p: Product, need: str) -> bool:
    a = p.attributes
    if need == "hydrating":
        return bool(a.get("hydrating"))
    if need == "spf":
        return float(a.get("spf", 0) or 0) > 0
    if need == "brightening":
        return str(a.get("key_ingredient", "")) in ("vitamin c", "niacinamide")
    if need == "gentle":
        return "sensitive" in product_skin_types(p) or bool(a.get("fragrance_free"))
    if need == "fragrance_free":
        return bool(a.get("fragrance_free"))
    return False


def violates_avoid(p: Product, avoid: str) -> bool:
    if avoid == "fragrance":
        return not bool(p.attributes.get("fragrance_free"))
    return avoid.lower() in str(p.attributes.get("key_ingredient", "")).lower()
