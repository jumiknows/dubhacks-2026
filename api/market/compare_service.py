"""Compare two listings that already have bang-per-buck, relevancy, and trust."""

from __future__ import annotations

from pydantic import BaseModel, Field

from api.market.valued import ValuedItem, finish

MARGIN = 0.05


class CompareRequest(BaseModel):
    left: ValuedItem
    right: ValuedItem
    trust_floor: float = Field(default=0.5, ge=0, le=1)
    min_price: float | None = None
    max_price: float | None = None
    brands_include: list[str] = []
    brands_exclude: list[str] = []


class Axis(BaseModel):
    name: str
    left: float
    right: float
    winner: str | None
    note: str = ""


class CompareResponse(BaseModel):
    left: ValuedItem
    right: ValuedItem
    axes: list[Axis]
    pick: str | None
    split_decision: bool
    reasons: list[str]
    trust_floor: float
    method: str = "bang_per_buck * relevancy * trust_multiplier"


def compare_items(left: ValuedItem, right: ValuedItem, trust_floor: float = 0.5) -> CompareResponse:
    a = finish(left, trust_floor)
    b = finish(right, trust_floor)
    axes = [
        _axis("bang_per_buck", a.bang_per_buck, b.bang_per_buck, "higher is more utility per landed dollar"),
        _axis("relevancy", a.relevancy, b.relevancy, "higher matches the prompt more closely"),
        _axis("initial_value", a.initial_value or 0, b.initial_value or 0, "bang per buck × relevancy"),
        _axis("trust", a.trust, b.trust, "review/seller quality before the floor"),
        _axis("trust_multiplier", a.trust_multiplier or 0, b.trust_multiplier or 0, f"floor {trust_floor}"),
        _axis("score", a.score or 0, b.score or 0, "headline"),
        *_spec_axes(a, b),
    ]
    pick, split, reasons = _decide(a, b)
    return CompareResponse(
        left=a,
        right=b,
        axes=axes,
        pick=pick,
        split_decision=split,
        reasons=reasons,
        trust_floor=trust_floor,
    )


def _spec_axes(left: ValuedItem, right: ValuedItem) -> list[Axis]:
    keys = sorted(set(left.specs or {}) & set(right.specs or {}))
    axes: list[Axis] = []
    lower_better = {"weight", "packed size", "price"}
    for key in keys:
        lv = _number(left.specs[key])
        rv = _number(right.specs[key])
        if lv is None or rv is None:
            axes.append(Axis(name=key, left=0, right=0, winner=None, note="incomplete"))
            continue
        better_left = lv < rv if key.lower() in lower_better else lv > rv
        better_right = rv < lv if key.lower() in lower_better else rv > lv
        winner = "left" if better_left and abs(lv - rv) >= 0.05 else "right" if better_right and abs(lv - rv) >= 0.05 else None
        axes.append(Axis(name=key, left=round(lv, 4), right=round(rv, 4), winner=winner, note=left.specs[key] + " vs " + right.specs[key]))
    return axes


def _number(text: str) -> float | None:
    import re
    match = re.search(r"(\d+(?:\.\d+)?)", text or "")
    return float(match.group(1)) if match else None


def _axis(name: str, left: float, right: float, note: str) -> Axis:
    delta = left - right
    if abs(delta) < MARGIN:
        winner = None
    else:
        winner = "left" if delta > 0 else "right"
    return Axis(name=name, left=round(left, 4), right=round(right, 4), winner=winner, note=note)


def _decide(a: ValuedItem, b: ValuedItem) -> tuple[str | None, bool, list[str]]:
    reasons = [
        f"{a.title or a.id}: score {a.score} (bang {a.bang_per_buck} × relevancy {a.relevancy} × trust×{a.trust_multiplier})",
        f"{b.title or b.id}: score {b.score} (bang {b.bang_per_buck} × relevancy {b.relevancy} × trust×{b.trust_multiplier})",
    ]
    if not a.in_stock and b.in_stock:
        return "right", False, reasons + [f"{a.title or a.id} is out of stock"]
    if a.in_stock and not b.in_stock:
        return "left", False, reasons + [f"{b.title or b.id} is out of stock"]
    sa, sb = a.score or 0, b.score or 0
    if abs(sa - sb) < MARGIN:
        return None, True, reasons + ["scores are too close to pick a winner"]
    pick = "left" if sa > sb else "right"
    return pick, False, reasons
