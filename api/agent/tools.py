"""The agent's tools. Exactly five; none of them can pay.

Each tool returns a ToolOutcome: `result` (what the LLM sees, which never includes raw
review text) and `actions` (UIActions to stream to the frontend).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field

from api import checkout, nlu
from api.schemas import (
    Dismissal, HighlightTrust, OpenCompare, PreferenceProfile, Product, RankedProduct, Rerank,
    ShowResults, Tradeoff, UpdateProfile,
)
from api.search import SearchRequest, ranker
from api.sessions import Session
from api.store import store


@dataclass
class ToolOutcome:
    result: dict[str, Any]
    actions: list[BaseModel] = field(default_factory=list)


# --- argument models (validated before any tool runs) ---------------------


class SearchArgs(BaseModel):
    query: str = Field(default="", max_length=300)
    max_price: float | None = Field(default=None, ge=0, le=10_000)
    subcategory: str | None = Field(default=None, max_length=30)
    limit: int = Field(default=6, ge=1, le=12)


class ProductArg(BaseModel):
    product_id: str = Field(max_length=20)


class CompareArgs(BaseModel):
    product_a: str = Field(max_length=20)
    product_b: str = Field(max_length=20)


class ProfileArgs(BaseModel):
    needs: list[str] | None = None
    avoid: list[str] | None = None
    budget_max: float | None = Field(default=None, ge=0, le=10_000)
    skin_type: str | None = Field(default=None, max_length=60)


class StageArgs(BaseModel):
    product_id: str = Field(max_length=20)
    quantity: int = Field(default=1, ge=1, le=10)
    unit_price: float | None = Field(default=None, ge=0)


# --- helpers --------------------------------------------------------------


def money(x: float) -> str:
    return f"${x:.2f}".replace(".00", "")


def _brief(p: RankedProduct | Product) -> dict[str, Any]:
    t = store.trust_report(p.id)
    out: dict[str, Any] = {
        "id": p.id, "title": p.title, "brand": p.brand, "price": p.price, "subcategory": p.subcategory,
        "fragrance_free": p.attributes.get("fragrance_free"), "skin_type": p.attributes.get("skin_type"),
        "trust_score": t.score if t else None, "trust_tier": t.tier if t else None,
        "rating_adjusted": t.rating_adjusted if t else None,
    }
    if isinstance(p, RankedProduct):
        out["fit_percent"] = p.fit_percent
        out["reasons"] = p.reasons
    return out


def require_product(product_id: str) -> Product:
    p = store.product(product_id)
    if p is None:
        raise ValueError(f"Unknown product id {product_id!r}")
    return p


def merge_parsed(profile: PreferenceProfile, q: nlu.ParsedQuery, provenance: str = "said") -> PreferenceProfile:
    """Returns a new profile with the parsed constraints added."""
    prof = profile.model_copy(deep=True)
    for n in q.needs:
        if n not in prof.needs:
            prof.needs.append(n)
            prof.provenance[f"needs:{n}"] = provenance  # type: ignore[assignment]
    for a in q.avoid:
        if a not in prof.avoid:
            prof.avoid.append(a)
            prof.provenance[f"avoid:{a}"] = provenance  # type: ignore[assignment]
    if q.budget_max is not None:
        prof.budget_max = q.budget_max
        prof.provenance["budget_max"] = provenance  # type: ignore[assignment]
    if q.skin_types:
        prof.skin_type = ",".join(q.skin_types)
        prof.provenance["skin_type"] = provenance  # type: ignore[assignment]
    return prof


def run_search(
    session: Session | None, args: SearchArgs, profile: PreferenceProfile | None = None, limit: int | None = None
) -> list[RankedProduct]:
    """Search, applying constraints parsed from the query on top of the session profile (not persisted).
    `limit` overrides the agent-facing cap in SearchArgs for internal callers."""
    base = profile or (session.profile if session else PreferenceProfile())
    parsed = nlu.parse(args.query)
    effective = merge_parsed(base, parsed)
    req = SearchRequest(query=args.query, max_price=args.max_price, limit=limit or args.limit,
                        subcategory=args.subcategory or parsed.subcategory)
    return ranker().search(req, effective, session.intent_mandate if session else None)


# --- tools ----------------------------------------------------------------


def search_products(session: Session, args: SearchArgs, rerank_because: str | None = None) -> ToolOutcome:
    results = run_search(session, args)
    ids = [r.id for r in results]
    session.last_results, session.last_query = ids, args.query
    if rerank_because:
        action: BaseModel = Rerank(product_ids=ids, changed_because=rerank_because)
    else:
        action = ShowResults(product_ids=ids, reason=f"Best matches for: {args.query}"[:200] if args.query else "Best matches for your profile")
    return ToolOutcome({"results": [_brief(r) for r in results], "count": len(results)}, [action])


def get_trust(session: Session, args: ProductArg) -> ToolOutcome:
    p = require_product(args.product_id)
    t = store.trust_report(p.id)
    if t is None:
        return ToolOutcome({"product_id": p.id, "error": "no trust report"})
    result = {
        "product_id": p.id, "title": p.title, "score": t.score, "tier": t.tier,
        "rating_listed": t.rating_listed, "rating_adjusted": t.rating_adjusted,
        "review_count": p.review_count,
        "signals": [{"key": s.key, "subscore": s.subscore, "detail": s.detail} for s in t.signals],
        "top_reasons": t.top_reasons, "has_security_flags": bool(t.security_flags),
    }
    session.focused_id = p.id
    return ToolOutcome(result, [HighlightTrust(product_id=p.id)])


def tradeoffs(a: Product, b: Product) -> list[Tradeoff]:
    ta, tb = store.trust_report(a.id), store.trust_report(b.id)
    out = [Tradeoff(dimension="Price", a=money(a.price), b=money(b.price),
                    better=None if a.price == b.price else ("a" if a.price < b.price else "b"))]

    def trust_str(t: Any) -> str:
        return "Not enough reviews" if t is None or t.score is None else f"{t.score} ({t.tier})"

    sa = ta.score if ta and ta.score is not None else None
    sb = tb.score if tb and tb.score is not None else None
    better = None if sa is None or sb is None or sa == sb else ("a" if sa > sb else "b")
    out.append(Tradeoff(dimension="Trust Score", a=trust_str(ta), b=trust_str(tb), better=better))

    ra, rb = (ta.rating_adjusted if ta else 0.0), (tb.rating_adjusted if tb else 0.0)
    out.append(Tradeoff(dimension="Adjusted rating", a=f"{ra:.1f}", b=f"{rb:.1f}",
                        better=None if ra == rb else ("a" if ra > rb else "b")))

    ma, mb = a.attributes.get("size_ml"), b.attributes.get("size_ml")
    if isinstance(ma, (int, float)) and isinstance(mb, (int, float)) and ma and mb:
        pa, pb = a.price / ma, b.price / mb
        out.append(Tradeoff(dimension="Price per ml", a=f"${pa:.2f}", b=f"${pb:.2f}",
                            better=None if round(pa, 2) == round(pb, 2) else ("a" if pa < pb else "b")))

    fa, fb = bool(a.attributes.get("fragrance_free")), bool(b.attributes.get("fragrance_free"))
    out.append(Tradeoff(dimension="Fragrance", a="Fragrance-free" if fa else "Contains fragrance",
                        b="Fragrance-free" if fb else "Contains fragrance", better=None if fa == fb else ("a" if fa else "b")))
    out.append(Tradeoff(dimension="Skin types", a=str(a.attributes.get("skin_type", "")).replace(",", ", "),
                        b=str(b.attributes.get("skin_type", "")).replace(",", ", ")))
    out.append(Tradeoff(dimension="Key ingredient", a=str(a.attributes.get("key_ingredient", "")),
                        b=str(b.attributes.get("key_ingredient", ""))))
    return out


def compare(session: Session, args: CompareArgs) -> ToolOutcome:
    a, b = require_product(args.product_a), require_product(args.product_b)
    if a.id == b.id:
        raise ValueError("Pick two different products to compare")
    tos = tradeoffs(a, b)
    result = {"a": _brief(a), "b": _brief(b), "tradeoffs": [t.model_dump() for t in tos]}
    return ToolOutcome(result, [OpenCompare(product_ids=(a.id, b.id), tradeoffs=tos)])


def update_profile(session: Session, args: ProfileArgs, provenance: str = "said") -> ToolOutcome:
    q = nlu.ParsedQuery(text="", budget_max=args.budget_max,
                        skin_types=[s.strip() for s in (args.skin_type or "").split(",") if s.strip()],
                        needs=args.needs or [], avoid=args.avoid or [])
    session.profile = merge_parsed(session.profile, q, provenance)
    return ToolOutcome({"profile": session.profile.model_dump()}, [UpdateProfile(profile=session.profile)])


def stage_checkout(session: Session, args: StageArgs) -> ToolOutcome:
    require_product(args.product_id)
    action = checkout.stage(session, args.product_id, args.quantity, args.unit_price)
    result: dict[str, Any] = {"allowed": action.policy.allowed,
                              "failed_checks": [c.reason for c in action.policy.checks if not c.passed]}
    if action.policy.allowed:
        result["total"] = action.cart.total  # type: ignore[union-attr]
        result["note"] = "Staged for the user to review and sign. You cannot complete payment."
    return ToolOutcome(result, [action])


def apply_feedback(session: Session, product_id: str, signal: str, reason: str | None, provenance: str = "gesture") -> ToolOutcome:
    """Like or dismiss a product, then rerank the last results."""
    p = require_product(product_id)
    prof = session.profile
    if signal == "like":
        if p.id not in prof.liked_ids:
            prof.liked_ids.append(p.id)
        because = f"You liked {p.title}, so similar products moved up."
    else:
        prof.dismissed = [d for d in prof.dismissed if d.id != p.id] + [Dismissal(id=p.id, reason=reason)]
        prof.liked_ids = [i for i in prof.liked_ids if i != p.id]
        because = f"You dismissed {p.title}."
        r = (reason or "").lower().strip()
        if r == "fragrance" or nlu.mentions_fragrance_problem(r):
            if "fragrance" not in prof.avoid:
                prof.avoid.append("fragrance")
                prof.provenance["avoid:fragrance"] = provenance  # type: ignore[assignment]
            because += " Products with fragrance are now hidden."
    prof.provenance[f"{signal}:{p.id}"] = provenance  # type: ignore[assignment]
    outcome = search_products(session, SearchArgs(query=session.last_query), rerank_because=because)
    outcome.actions.append(UpdateProfile(profile=session.profile))
    outcome.result["changed_because"] = because
    return outcome


# --- registry -------------------------------------------------------------

REGISTRY: dict[str, tuple[type[BaseModel], Any, str]] = {
    "search_products": (SearchArgs, search_products, "Search the catalog. Applies the user's profile and hard filters."),
    "get_trust": (ProductArg, get_trust, "Get the Trust Score report for one product."),
    "compare": (CompareArgs, compare, "Compare two products side by side."),
    "update_profile": (ProfileArgs, update_profile, "Record preferences the user explicitly stated in their own words."),
    "stage_checkout": (StageArgs, stage_checkout, "Propose a cart for the user to sign. Only after an explicit yes. Cannot pay."),
}


def openai_tool_schemas() -> list[dict[str, Any]]:
    return [
        {"type": "function", "function": {"name": name, "description": desc, "parameters": model.model_json_schema()}}
        for name, (model, _, desc) in REGISTRY.items()
    ]


def call(session: Session, name: str, raw_args: dict[str, Any]) -> ToolOutcome:
    if name not in REGISTRY:
        raise ValueError(f"Unknown tool {name!r}")
    model, fn, _ = REGISTRY[name]
    return fn(session, model.model_validate(raw_args))
