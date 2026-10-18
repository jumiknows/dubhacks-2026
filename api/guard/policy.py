"""Deterministic cart policy. Pure functions: no LLM, no I/O.

The agent proposes a cart; this decides whether it may be staged for signing.
"""

from __future__ import annotations

from dataclasses import dataclass

from api.schemas import IntentMandate, Merchant, PolicyCheck, PolicyResult, Product

DEFAULT_BUDGET = 100.0
DEFAULT_MAX_QUANTITY = 2


@dataclass(frozen=True)
class ProposedLine:
    product_id: str
    unit_price: float
    quantity: int


@dataclass(frozen=True)
class Limits:
    budget_max: float
    max_quantity: int
    categories: tuple[str, ...] | None  # None = any category
    verified_only: bool
    session_cap: float
    from_mandate: bool


def limits_for(mandate: IntentMandate | None, session_cap: float) -> Limits:
    if mandate is None:
        return Limits(DEFAULT_BUDGET, DEFAULT_MAX_QUANTITY, None, True, session_cap, False)
    return Limits(
        budget_max=mandate.budget_max,
        max_quantity=mandate.max_quantity,
        categories=tuple(c.lower() for c in mandate.categories) or None,
        verified_only=mandate.verified_only,
        session_cap=session_cap,
        from_mandate=True,
    )


def _money(x: float) -> str:
    return f"${x:,.2f}"


def _source(limits: Limits) -> str:
    return "your signed rules" if limits.from_mandate else "safe defaults (no signed rules yet)"


def evaluate(
    lines: list[ProposedLine],
    catalog: dict[str, Product],
    merchants: dict[str, Merchant],
    limits: Limits,
    spent_so_far: float,
) -> PolicyResult:
    checks: list[PolicyCheck] = []

    def check(rule: str, passed: bool, reason: str) -> None:
        checks.append(PolicyCheck(rule=rule, passed=passed, reason=reason))

    if not lines:
        check("cart_not_empty", False, "The proposed cart has no items.")
        return PolicyResult(allowed=False, checks=checks)

    total = 0.0
    for line in lines:
        p = catalog.get(line.product_id)
        if p is None:
            check("product_exists", False, f"Product {line.product_id} is not in the catalog.")
            continue
        check("product_exists", True, f"{p.title} is in the catalog.")

        price_ok = abs(line.unit_price - p.price) < 0.005
        check(
            "price_matches_catalog",
            price_ok,
            f"Price {_money(line.unit_price)} matches the catalog."
            if price_ok
            else f"Proposed price {_money(line.unit_price)} does not match the catalog price {_money(p.price)}.",
        )

        m = merchants.get(p.merchant_id)
        if m is None:
            check("merchant_known", False, f"Seller {p.merchant_id} is not a known merchant.")
        elif limits.verified_only:
            check(
                "merchant_verified",
                m.verified,
                f"{m.name} has local catalog approval; this is not independent website verification." if m.verified
                else f"{m.name} lacks local catalog approval, and {_source(limits)} require approved sellers.",
            )
        else:
            check("merchant_known", True, f"{m.name} is a known merchant (verified-only is off).")

        qty_ok = 1 <= line.quantity <= limits.max_quantity
        check(
            "quantity_limit",
            qty_ok,
            f"Quantity {line.quantity} is within the limit of {limits.max_quantity} from {_source(limits)}."
            if qty_ok
            else f"Quantity {line.quantity} exceeds the limit of {limits.max_quantity} from {_source(limits)}.",
        )

        if limits.categories is None:
            check("category_allowed", True, f"Any category is allowed by {_source(limits)}.")
        else:
            cat_ok = p.subcategory.lower() in limits.categories
            check(
                "category_allowed",
                cat_ok,
                f"{p.subcategory.title()} is an allowed category." if cat_ok
                else f"{p.subcategory.title()} is not in your allowed categories ({', '.join(limits.categories)}).",
            )
        total += p.price * line.quantity

    total = round(total, 2)
    budget_ok = total <= limits.budget_max
    check(
        "within_budget",
        budget_ok,
        f"Total {_money(total)} is within the {_money(limits.budget_max)} budget from {_source(limits)}."
        if budget_ok
        else f"Total {_money(total)} is over the {_money(limits.budget_max)} budget from {_source(limits)}.",
    )

    after = round(spent_so_far + total, 2)
    cap_ok = after <= limits.session_cap
    check(
        "session_spend_cap",
        cap_ok,
        f"Session spend would be {_money(after)} of the {_money(limits.session_cap)} cap."
        if cap_ok
        else f"Session spend would reach {_money(after)}, over the {_money(limits.session_cap)} cap.",
    )

    return PolicyResult(allowed=all(c.passed for c in checks), checks=checks)
