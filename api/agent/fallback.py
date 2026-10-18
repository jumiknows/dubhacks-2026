"""Deterministic, rule-based agent. Handles the demo path with no LLM.

Uses the same tools as the LLM agent, so it produces the same UIActions, and every
number it speaks comes straight from a tool result.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from api import nlu
from api.agent import tools
from api.agent.tools import ToolOutcome, money
from api.schemas import OpenDetail, ToolTrace, UIContext
from api.sessions import Session
from api.store import store

_BUY = re.compile(
    r"\b(yes|yeah|yep|buy|purchase|check ?out|order (it|this|that|one|two|\d+)|get it|add (it |this |that )?to (my )?cart"
    r"|take it|i'?ll take (it|this|that|one|two|\d+)|let'?s do it|go ahead"
    r"|get me (this|that|it|these|those|(one|two|three|\d+) of (these|those|them|this|that)))\b"
)
_NO = re.compile(r"^\s*(no|nope|nah|not now|cancel|never ?mind)\b")
_CHEAPER = re.compile(r"\b(cheaper|less expensive|lower price|more affordable|budget option|too expensive|too pricey)\b")
_BEST = re.compile(r"\b(best|top pick|which (one )?should i (get|buy|pick|choose)|what do you recommend|your recommendation)\b")
_SUITABLE = re.compile(r"\b(good|ok|okay|safe|work|suitable|right|fine)\b.{0,15}\bfor\b.{0,20}\b(dry|oily|combination|sensitive|normal)\b")
_GREETING = re.compile(r"^\s*(hi|hello|hey|yo|good (morning|afternoon|evening))\b")
_ANY_CATEGORY = re.compile(r"\b(anything|any product|all products|everything|any category)\b")
_TRUST = re.compile(r"\b(flag\w*|trust\w*|suspicious|fake|legit|reviews?|caution)\b")
_WHY_SEEING = re.compile(r"\bwhy\b.{0,30}\b(seeing|this one|recommend\w*|here|first|top)\b")
_COMPARE = re.compile(r"\b(compare|comparison|versus|vs\.?|difference|which is better)\b")
_DISLIKE = re.compile(r"\b(don'?t like|dislike|not (this|that) one|remove|hide|no thanks|not for me|skip)\b")
_LIKE = re.compile(r"\b(i (like|love) (this|that|it)|more like (this|that)|this one'?s? (good|nice|great))\b")
_DETAIL = re.compile(r"\b(tell me more|tell me about|details?|more info|open|what'?s in|show me (this|that)|ingredients?)\b")
_QTY = re.compile(r"\b(\d+|one|two|three|four|five)\b\s*(of them|bottles?|units?|jars?|tubes?)?")
_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}

_PATTERN = {
    "velocity": "a coordinated review burst",
    "duplicates": "copied reviews",
    "verified": "mostly unverified reviewers",
    "consistency": "star ratings that don't match the review text",
    "distribution": "an inflated share of 5-star ratings",
}

AI_DISCLOSURE = "Hi, I'm Conjure, an AI shopping assistant, and I can't spend money without your signature."


def explicit_yes(text: str) -> bool:
    """Deterministic consent check used before any cart is staged, by either agent."""
    t = text.lower().strip()
    return bool(_BUY.search(t)) and not _NO.search(t)


@dataclass
class Turn:
    # Ordered stream events: ("trace" | "action", model). Order is what the UI shows.
    events: list[tuple[str, BaseModel]] = field(default_factory=list)
    speech: str = ""
    facts: list[dict[str, Any]] = field(default_factory=list)  # tool results, for grounding
    tool_calls: list[dict[str, Any]] = field(default_factory=list)

    @property
    def actions(self) -> list[BaseModel]:
        return [m for kind, m in self.events if kind == "action"]

    def action(self, model: BaseModel) -> None:
        self.events.append(("action", model))

    def add(self, name: str, args: dict[str, Any], outcome: ToolOutcome) -> ToolOutcome:
        self.tool_calls.append({"name": name, "args": args})
        self.events.append(("trace", ToolTrace(name=name, args=args, ms=outcome.ms)))
        self.events.extend(("trace", t) for t in outcome.traces)
        self.events.extend(("action", a) for a in outcome.actions)
        self.facts.append(outcome.result)
        return outcome


def _focus(session: Session, ctx: UIContext) -> str | None:
    for pid in (ctx.focused_id, session.focused_id):
        if pid and store.product(pid):
            return pid
    return None


def _quantity(text: str) -> int:
    for m in _QTY.finditer(text):
        tok = m.group(1)
        if m.group(2) or tok not in ("one",):  # "this one" is not a quantity
            n = int(tok) if tok.isdigit() else _WORDS.get(tok, 1)
            if 1 <= n <= 10:
                return n
    return 1


def _visible(session: Session, ctx: UIContext) -> list[str]:
    ids = [i for i in ctx.visible_ids if store.product(i)]
    return ids or session.last_results


def _search(session: Session, text: str, turn: Turn) -> None:
    q = nlu.parse(text)
    prof_args = tools.ProfileArgs(needs=q.needs or None, avoid=q.avoid or None, budget_max=q.budget_max,
                                  skin_type=",".join(q.skin_types) or None)
    turn.add("update_profile", prof_args.model_dump(exclude_none=True), tools.update_profile(session, prof_args))
    # Follow-ups ("under $25 please") stay in the category the user was already browsing.
    subcategory = q.subcategory
    if subcategory is None and not _ANY_CATEGORY.search(text.lower()):
        subcategory = session.last_subcategory
    args = tools.SearchArgs(query=text[:300], subcategory=subcategory)
    out = turn.add("search_products", args.model_dump(exclude_none=True), tools.search_products(session, args))
    results = out.result["results"]
    if not results:
        turn.speech = "I couldn't find anything that meets all of those requirements. Try raising the budget or removing a filter."
        return
    noun = subcategory or "product"
    noun = noun if len(results) == 1 else f"{noun}s"
    top = results[0]
    trust = f"a Trust Score of {top['trust_score']}" if top["trust_score"] is not None else "too few reviews for a Trust Score"
    fit = "fits" if len(results) == 1 else "fit"
    first = f"I found {len(results)} {noun} that {fit}; the top match is {top['title']} at {money(top['price'])} with {trust}."
    flagged = next((r for r in results if r["trust_tier"] in ("caution", "mixed")), None)
    if flagged:
        second = f"{flagged['title']} is marked {flagged['trust_tier']}, so ask me why before you pick it."
    else:
        second = "Tap any card to see why it's here."
    turn.speech = f"{first} {second}"
    session.focused_id = None


def _trust(session: Session, ctx: UIContext, turn: Turn) -> None:
    pid = _focus(session, ctx)
    if pid is None:
        visible = _visible(session, ctx)
        ranked = sorted(
            (store.trust_report(i) for i in visible if store.trust_report(i)),
            key=lambda r: (r.score if r.score is not None else 101),  # type: ignore[union-attr]
        )
        pid = ranked[0].product_id if ranked else None  # type: ignore[union-attr]
    if pid is None:
        turn.speech = "Which product? Point at a card or tap it, then ask again."
        return
    out = turn.add("get_trust", {"product_id": pid}, tools.get_trust(session, tools.ProductArg(product_id=pid)))
    r = out.result
    if r.get("score") is None:
        turn.speech = f"{r['title']} has only {r['review_count']} reviews, too few for a Trust Score, so I'd treat its rating of {r['rating_listed']} as unproven."
        return
    weakest = min(r["signals"], key=lambda s: s["subscore"])
    if r["has_security_flags"]:
        turn.speech = (f"{r['title']} is capped at caution because a review contains hidden instructions aimed at AI assistants; I ignored it. "
                       f"Its adjusted rating is {r['rating_adjusted']} from {r['review_count']} reviews.")
    elif r["tier"] == "trusted":
        turn.speech = (f"{r['title']} has a Trust Score of {r['score']}, which is trusted. "
                       f"The weakest signal is still healthy: {weakest['detail']}")
    else:
        detail = weakest["detail"].rstrip(".")
        turn.speech = (f"{r['title']} has a Trust Score of {r['score']}, with patterns consistent with "
                       f"{_PATTERN[weakest['key']]}, based on the {weakest['key']} signal: {detail}. "
                       f"Its adjusted rating is {r['rating_adjusted']} instead of {r['rating_listed']}.")


def _why_seeing(session: Session, ctx: UIContext, turn: Turn) -> bool:
    pid = _focus(session, ctx)
    if pid is None:
        return False
    results = tools.run_search(session, tools.SearchArgs(query=session.last_query), limit=50)
    match = next((r for r in results if r.id == pid), None)
    if match is None:
        return False
    turn.facts.append({"product_id": pid, "fit_percent": match.fit_percent, "fit_terms": match.fit_terms.model_dump()})
    turn.action(OpenDetail(product_id=pid))
    reasons = " and ".join(r.lower() for r in match.reasons) or "your search"
    turn.speech = f"{match.title} is a {match.fit_percent}% fit, mostly because of {reasons}."
    return True


def _compare(session: Session, ctx: UIContext, turn: Turn) -> None:
    visible = _visible(session, ctx)
    focus = _focus(session, ctx)
    ids = ([focus] if focus else []) + [i for i in visible if i != focus]
    if len(ids) < 2:
        turn.speech = "Show me at least two products first, then ask me to compare."
        return
    a, b = ids[0], ids[1]
    out = turn.add("compare", {"product_a": a, "product_b": b}, tools.compare(session, tools.CompareArgs(product_a=a, product_b=b)))
    ra, rb = out.result["a"], out.result["b"]
    cheaper = ra if ra["price"] <= rb["price"] else rb
    sa, sb = ra["trust_score"] or 0, rb["trust_score"] or 0
    more_trusted = ra if sa >= sb else rb
    turn.speech = (f"{cheaper['title']} is cheaper at {money(cheaper['price'])}, while {more_trusted['title']} has the higher Trust Score at {more_trusted['trust_score']}."
                   if cheaper["id"] != more_trusted["id"] else
                   f"{cheaper['title']} is both cheaper at {money(cheaper['price'])} and more trusted at {cheaper['trust_score']}.")
    turn.speech += " The full side-by-side is on screen."


def _feedback(session: Session, ctx: UIContext, text: str, turn: Turn, signal: str) -> None:
    pid = _focus(session, ctx)
    if pid is None:
        turn.speech = "Which one? Point at a card or tap it first."
        return
    reason = "fragrance" if nlu.mentions_fragrance_problem(text) else None
    out = turn.add("feedback", {"product_id": pid, "signal": signal, "reason": reason},
                   tools.apply_feedback(session, pid, signal, reason, provenance="said"))
    session.focused_id = None
    if signal == "like":
        turn.speech = "Got it, I moved similar products up."
    elif reason == "fragrance":
        turn.speech = "Got it, I removed it and I'll hide anything with fragrance from now on."
    else:
        turn.speech = "Got it, I removed that one."
    turn.speech += f" You now have {out.result['count']} results."


def _detail(session: Session, ctx: UIContext, turn: Turn) -> None:
    pid = _focus(session, ctx) or (_visible(session, ctx) or [None])[0]
    if pid is None:
        turn.speech = "Which product? Point at a card or tap it first."
        return
    p = store.product(pid)
    assert p is not None
    t = store.trust_report(pid)
    session.focused_id = pid
    turn.action(OpenDetail(product_id=pid))
    turn.facts.append({"product_id": pid, "price": p.price, "summary": p.summary,
                       "trust_score": t.score if t else None, "rating_adjusted": t.rating_adjusted if t else None})
    trust = f"a Trust Score of {t.score}" if t and t.score is not None else "too few reviews for a Trust Score"
    first_sentence = p.summary.split(". ")[0].rstrip(".")
    turn.speech = f"{p.title} costs {money(p.price)} and has {trust}. {first_sentence}."


def _buy(session: Session, ctx: UIContext, text: str, turn: Turn) -> None:
    pid = _focus(session, ctx)
    if pid is None:
        visible = _visible(session, ctx)
        pid = visible[0] if len(visible) == 1 else None
    if pid is None:
        turn.speech = "Which one should I put in the cart? Point at it or tap it first."
        return
    qty = _quantity(text)
    args = tools.StageArgs(product_id=pid, quantity=qty)
    out = turn.add("stage_checkout", args.model_dump(exclude_none=True), tools.stage_checkout(session, args))
    p = store.product(pid)
    assert p is not None
    if out.result["allowed"]:
        turn.speech = (f"I've staged {qty} of {p.title} for {money(out.result['total'])}, and every policy check passed. "
                       "Review the cart on screen and sign it to pay; I can't complete the purchase myself.")
    else:
        turn.speech = f"I can't stage that: {out.result['failed_checks'][0]} Nothing was charged."


def _cheaper(session: Session, ctx: UIContext, turn: Turn) -> None:
    ref_id = _focus(session, ctx) or next(iter(_visible(session, ctx)), None)
    ref = store.product(ref_id) if ref_id else None
    if ref is None:
        turn.speech = "Tell me what you're looking for first, and then I can find cheaper options."
        return
    turn.facts.append({"reference_product": ref.title, "reference_price": ref.price})
    args = tools.SearchArgs(query=session.last_query, subcategory=session.last_subcategory or ref.subcategory,
                            max_price=round(ref.price - 0.01, 2))
    because = f"Showing options cheaper than {ref.title} ({money(ref.price)})."
    out = turn.add("search_products", args.model_dump(exclude_none=True), tools.search_products(session, args, rerank_because=because))
    results = out.result["results"]
    if not results:
        turn.speech = f"Nothing cheaper than {ref.title} at {money(ref.price)} fits your other requirements."
        return
    cheapest = min(results, key=lambda r: r["price"])
    options = "option" if len(results) == 1 else "options"
    turn.speech = (f"Here {'is' if len(results) == 1 else 'are'} {len(results)} {options} under {money(ref.price)}; "
                   f"the cheapest is {cheapest['title']} at {money(cheapest['price'])}.")


def _best(session: Session, ctx: UIContext, turn: Turn) -> None:
    visible = _visible(session, ctx)
    if not visible:
        turn.speech = "Tell me what you're looking for, and I'll find the best match."
        return
    p, t = store.product(visible[0]), store.trust_report(visible[0])
    assert p is not None
    session.focused_id = p.id
    turn.action(OpenDetail(product_id=p.id))
    turn.facts.append({"product_id": p.id, "price": p.price, "trust_score": t.score if t else None})
    trust = f"a Trust Score of {t.score}" if t and t.score is not None else "too few reviews for a Trust Score"
    turn.speech = f"For what you asked, the top match is {p.title} at {money(p.price)} with {trust}."


def _suitable(session: Session, ctx: UIContext, text: str, turn: Turn) -> bool:
    pid = _focus(session, ctx)
    m = _SUITABLE.search(text)
    p = store.product(pid) if pid else None
    if p is None or m is None:
        return False
    asked = m.group(2)
    types = nlu.product_skin_types(p)
    turn.action(OpenDetail(product_id=p.id))
    turn.facts.append({"product_id": p.id, "skin_type": p.attributes.get("skin_type")})
    made_for = ", ".join(types) or "general"
    fragrance = "it's fragrance-free" if p.attributes.get("fragrance_free") else "it contains fragrance"
    if asked in types:
        turn.speech = f"Yes, {p.title} is made for {made_for} skin, and {fragrance}."
    else:
        turn.speech = f"{p.title} is made for {made_for} skin, not specifically {asked} skin, and {fragrance}."
    return True


def respond(session: Session, text: str, ctx: UIContext) -> Turn:
    turn = Turn()
    t = text.lower().strip()
    if ctx.focused_id and store.product(ctx.focused_id):
        session.focused_id = ctx.focused_id

    if _NO.search(t):
        turn.speech = "No problem, nothing was added to a cart."
    elif _GREETING.search(t) and not nlu.parse(t).has_shopping_terms:
        turn.speech = "Hi! Tell me what you're shopping for, like a fragrance-free moisturizer for dry skin."
    elif _BUY.search(t) and not _COMPARE.search(t):
        _buy(session, ctx, t, turn)
    elif _COMPARE.search(t):
        _compare(session, ctx, turn)
    elif _WHY_SEEING.search(t) and not _TRUST.search(t) and _why_seeing(session, ctx, turn):
        pass
    elif _TRUST.search(t) or t.startswith("why"):
        _trust(session, ctx, turn)
    elif nlu.mentions_fragrance_problem(t) or _DISLIKE.search(t):
        _feedback(session, ctx, t, turn, "dismiss")
    elif _LIKE.search(t):
        _feedback(session, ctx, t, turn, "like")
    elif _CHEAPER.search(t):
        _cheaper(session, ctx, turn)
    elif _SUITABLE.search(t) and _suitable(session, ctx, t, turn):
        pass
    elif _DETAIL.search(t) and _focus(session, ctx):
        _detail(session, ctx, turn)
    elif nlu.parse(t).has_shopping_terms:
        _search(session, text, turn)
    elif _BEST.search(t):
        _best(session, ctx, turn)
    else:
        turn.facts.append({"example_budget": 40})
        turn.speech = ("I can search, compare two products, or explain a Trust Score. "
                       "Try saying: fragrance-free moisturizer for dry skin under $40.")
    return turn
