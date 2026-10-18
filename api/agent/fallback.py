"""Deterministic, rule-based agent. Handles the demo path with no LLM.

Uses the same tools as the LLM agent, so it produces the same UIActions, and every
number it speaks comes straight from a tool result.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from pydantic import BaseModel

from api import nlu
from api.agent import tools
from api.agent.tools import ToolOutcome, money
from api.normalization import parse_amount
from api.schemas import OpenDetail, ToolTrace, UIContext
from api.sessions import Session
from api.store import store

_BUY = re.compile(
    r"\b(yes|yeah|yep|buy|purchase|check ?out|order (it|this|that|one|two|\d+)|get it|add (it |this |that )?to (my )?cart"
    r"|take it|i'?ll take (it|this|that|one|two|\d+)|let'?s do it|go ahead"
    r"|get me (this|that|it|these|those|(one|two|three|\d+) of (these|those|them|this|that)))\b"
)
_NO = re.compile(r"^\s*(?:no(?: thanks)?|nope|nah|not now|cancel|never ?mind)\s*[.!]?\s*$")
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
_DELIVERY = re.compile(r"\b(?:shipping|delivery|arriv\w*|deliver\w*|postage|ships?|shipped)\b", re.IGNORECASE)
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
    """Conservative purchase intent, never a question, condition, or negated command."""
    t = text.lower().replace("\u2019", "'").strip()
    if "?" in t or re.search(r"\b(no|not|never|don'?t|cannot|can'?t|cancel|stop|unless|if|maybe|might)\b", t):
        return False
    if re.fullmatch(r"(?:yes|yeah|yep|sure|ok|okay)[.!\s]*", t):
        return True  # stage_target additionally requires a preceding purchase proposal.
    return bool(re.match(
        r"^(?:(?:yes|yeah|yep|sure|ok(?:ay)?)[,\s!]+)?(?:please\s+)?"
        r"(?:buy\b|purchase\b|check ?out\b|order\b|i'?ll take\b|i (?:want|would like) to buy\b"
        r"|let'?s do it\b|go ahead\b|take it\b|get it\b"
        r"|get me (?:this|that|it|these|those|(?:one|two|three|four|five|\d+) of)\b"
        r"|add(?: (?:it|this|that))? to (?:my )?cart\b)", t,
    ))


def feedback_intent(text: str) -> str | None:
    """Feedback uses the deterministic tool, which the LLM registry cannot invoke."""
    t = text.lower()
    if _NO.search(t):
        return None
    if nlu.mentions_fragrance_problem(t) or _DISLIKE.search(t):
        return "dismiss"
    return "like" if _LIKE.search(t) else None


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
    if ctx.focused_id and store.product(ctx.focused_id):
        return ctx.focused_id
    current_ids = ctx.visible_ids if ctx.visible_ids else session.last_results
    if session.focused_id and session.focused_id in current_ids and store.product(session.focused_id):
        return session.focused_id
    return None


def _quantity(text: str) -> int:
    quantity = r"(\d+|one|two|three|four|five)"
    match = re.search(r"\b(?:buy|purchase|order|take|get me)\s+" + quantity + r"\b", text.lower())
    if match is None:
        match = re.search(r"\b" + quantity + r"\s+(?:of\b|bottles?\b|units?\b|jars?\b|tubes?\b)", text.lower())
    if match:
        token = match.group(1)
        return int(token) if token.isdigit() else _WORDS[token]
    return 1


def _visible(session: Session, ctx: UIContext) -> list[str]:
    ids = [i for i in ctx.visible_ids if store.product(i)]
    return ids or [i for i in session.last_results if store.product(i)]


def stage_target(session: Session, ctx: UIContext, text: str) -> str | None:
    """Resolve an explicit named listing, focused listing, or sole visible listing."""
    if not explicit_yes(text):
        return None
    if re.fullmatch(r"(?:yes|yeah|yep|sure|ok|okay)[.!\s]*", text.lower().strip()):
        previous = session.chat_history[-1]["content"] if session.chat_history else ""
        if not re.search(r"\b(?:cart|stage|buy|purchase)\b", previous, re.IGNORECASE) or "?" not in previous:
            return None
    names = [p.id for p in store.products.values() if (
        re.search(r"(?<!\w)" + re.escape(p.id) + r"(?!\w)", text, re.IGNORECASE)
        or p.title.casefold() in text.casefold()
    )]
    if names:
        return names[0] if len(names) == 1 else None
    deictic = re.search(r"\b(?:it|this|that|these|those|them)\b", text, re.IGNORECASE)
    neutral_command = re.fullmatch(
        r"(?:(?:yes|yeah|yep|sure|ok(?:ay)?)[,\s!]+)?(?:please\s+)?"
        r"(?:buy|purchase|check ?out|add to (?:my )?cart|go ahead|let'?s do it"
        r"|i'?ll take (?:one|two|three|four|five|\d+)|yes|yeah|yep|sure|ok|okay)[.!\s]*",
        text.lower().replace("\u2019", "'").strip(),
    )
    if not deictic and not neutral_command:
        return None  # A named-but-unknown product must not silently become the focused one.
    focused = _focus(session, ctx)
    if focused:
        return focused
    visible = _visible(session, ctx)
    return visible[0] if len(visible) == 1 else None


def stage_constraint_error(session: Session, product_id: str, quantity: int, text: str) -> str | None:
    """Check current user/profile constraints before either agent can propose a cart.

    Purchase authorization still runs its independent signed policy afterwards.
    These checks never change a cart, a preference, or a payment.
    """
    parsed = nlu.parse(text)
    if getattr(parsed, "budget_error", None):
        return parsed.budget_error
    product = store.product(product_id)
    if product is None or type(quantity) is not int or not 1 <= quantity <= 10:
        return "The product or quantity is not available for staging."
    mandate = session.intent_mandate
    ceilings = [value for value in (
        parsed.budget_max, session.profile.budget_max, mandate.budget_max if mandate else None,
    ) if value is not None]
    try:
        price = parse_amount(product.price, "USD")
        budgets = [parse_amount(value, "USD") for value in ceilings]
    except (ValueError, ArithmeticError):
        return "A price or budget is invalid; no cart was staged."
    if price is None or any(value is None for value in budgets):
        return "The price or budget is unknown; no cart was staged."
    if budgets and price * Decimal(quantity) > min(budgets):
        return "That product quantity exceeds your current merchandise budget."
    avoided = set(session.profile.avoid) | set(parsed.avoid)
    if any(nlu.violates_avoid(product, value) for value in avoided):
        return "That product does not satisfy your current avoided-attribute rules."
    if parsed.subcategory and product.subcategory != parsed.subcategory:
        return "That product does not match the category in your purchase request."
    if mandate and mandate.categories and product.subcategory.casefold() not in {
        category.casefold() for category in mandate.categories
    }:
        return "That category is not allowed by your signed rules."
    if mandate and mandate.verified_only and not store.merchant_verified(product.merchant_id):
        return "That merchant does not pass your signed merchant rule."
    if product_id in {dismissal.id for dismissal in session.profile.dismissed}:
        return "That product is dismissed in your current preferences."
    return None


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
    trust = (f"a Trust Score of {top['trust_score']}" if top["trust_score"] is not None else
             "no Trust Score evidence" if top["trust_tier"] is None else "too few reviews for a Trust Score")
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
    if "error" in r:
        turn.speech = "Review evidence is unavailable for that product."
        return
    if r.get("score") is None:
        turn.speech = f"{r['title']} has only {r['review_count']} reviews, too few for a Trust Score, so I'd treat its rating of {r['rating_listed']} as unproven."
        return
    weakest = min(r["signals"], key=lambda s: s["subscore"]) if r["signals"] else None
    if r["has_security_flags"]:
        turn.speech = (f"{r['title']} is capped at caution because a review contains instructions aimed at AI assistants. "
                       f"Its adjusted rating is {r['rating_adjusted']} from {r['review_count']} reviews.")
    elif weakest is None:
        turn.speech = f"{r['title']} has a Trust Score of {r['score']}, rated {r['tier']}. Supporting signal details are unavailable."
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
    price_sentence = (f"Both products cost {money(ra['price'])}." if ra["price"] == rb["price"] else
                      f"{cheaper['title']} is cheaper at {money(cheaper['price'])}.")
    sa, sb = ra["trust_score"], rb["trust_score"]
    if sa is None or sb is None:
        turn.speech = (price_sentence + " "
                       "A Trust Score is unavailable for at least one product; see the comparison on screen.")
        return
    more_trusted = ra if sa >= sb else rb
    trust_sentence = (f"Their Trust Scores are equal at {sa}." if sa == sb else
                      f"{more_trusted['title']} has the higher Trust Score at {more_trusted['trust_score']}.")
    turn.speech = price_sentence + " " + trust_sentence


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
    trust = (f"a Trust Score of {t.score}" if t and t.score is not None else
             "no Trust Score evidence" if t is None else "too few reviews for a Trust Score")
    first_sentence = p.summary.split(". ")[0].rstrip(".")
    turn.speech = f"{p.title} costs {money(p.price)} and has {trust}. {first_sentence}."


def _buy(session: Session, ctx: UIContext, text: str, turn: Turn) -> None:
    pid = stage_target(session, ctx, text)
    if pid is None:
        turn.speech = "Which one should I put in the cart? Point at it or tap it first."
        return
    qty = _quantity(text)
    if not 1 <= qty <= 10:
        turn.speech = "That quantity is outside the supported range; nothing was staged."
        return
    refusal = stage_constraint_error(session, pid, qty, text)
    if refusal:
        turn.facts.append({"blocked": refusal})
        turn.speech = f"I can't stage that: {refusal}"
        return
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
    trust = (f"a Trust Score of {t.score}" if t and t.score is not None else
             "no Trust Score evidence" if t is None else "too few reviews for a Trust Score")
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
    fragrance_status = p.attributes.get("fragrance_free")
    fragrance = ("it's fragrance-free" if fragrance_status is True else
                 "it contains fragrance" if fragrance_status is False else "its fragrance status is unknown")
    if not types:
        turn.speech = f"The source does not specify skin types for {p.title}, and {fragrance}."
    elif asked in types:
        turn.speech = f"Yes, {p.title} is made for {made_for} skin, and {fragrance}."
    else:
        turn.speech = f"{p.title} is made for {made_for} skin, not specifically {asked} skin, and {fragrance}."
    return True


def respond(session: Session, text: str, ctx: UIContext) -> Turn:
    turn = Turn()
    t = text.lower().strip()
    if ctx.focused_id and store.product(ctx.focused_id):
        session.focused_id = ctx.focused_id
    elif ctx.visible_ids and session.focused_id not in ctx.visible_ids:
        session.focused_id = None
    budget_error = getattr(nlu.parse(text), "budget_error", None)
    if budget_error:
        turn.facts.append({"blocked": budget_error})
        turn.speech = budget_error
        return turn
    if _DELIVERY.search(text) and re.search(r"\b(?:when|how much|how long|shipping cost)\b", text, re.IGNORECASE):
        turn.speech = "Shipping costs and arrival dates are unknown in this catalog."
        return turn

    if _NO.search(t):
        turn.speech = "No problem, nothing was added to a cart."
    elif _GREETING.search(t) and not nlu.parse(t).has_shopping_terms:
        turn.speech = "Hi! Tell me what you're shopping for, like a fragrance-free moisturizer for dry skin."
    elif explicit_yes(t) and not _COMPARE.search(t):
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
