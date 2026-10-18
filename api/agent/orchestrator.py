"""Runs one chat turn and streams it as Server-Sent Events.

Order: `trace` and `action` events as each tool returns (cards move while the assistant is
still thinking), then `say` (one per sentence), then `done`.

The LLM path enforces, in code: at most 4 tool calls and 1 stage_checkout per turn, an explicit
"yes" before stage_checkout, schema-validated arguments, profile writes only from the user's own
words, and grounded numbers. Any LLM failure falls back to the deterministic agent; repeated
failures trip the circuit breaker, and repeated anomalous turns trip the session kill switch.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from pydantic import BaseModel, TypeAdapter, ValidationError

from api.agent import fallback, llm, prompts, tools
from api.config import get_settings
from api.guard import audit, grounding, injection
from api.schemas import ChatRequest, PolicyTrace, ShowResults, ToolTrace, UIAction
from api.sessions import Session, breaker
from api.store import store

log = logging.getLogger(__name__)

_ACTION = TypeAdapter(UIAction)
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'$])")

MAX_TOOL_CALLS = 4
MAX_STAGE_CALLS = 1
MAX_ROUNDS = 4
KILL_SWITCH_AFTER = 2
ALLOWED_ACTIONS = {
    "show_results", "rerank", "open_detail", "open_compare", "highlight_trust",
    "update_profile", "stage_checkout", "policy_refusal", "say",
}


def sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE.split(text.strip()) if s.strip()]


def validate_action(action: BaseModel | dict) -> dict:
    """Round-trip every action through the UIAction schema. Invalid -> ValidationError."""
    raw = action.model_dump() if isinstance(action, BaseModel) else action
    return _ACTION.validate_python(raw).model_dump(mode="json")


def _safe_action(session: Session, action: BaseModel) -> dict:
    try:
        out = validate_action(action)
        if out["action"] in ALLOWED_ACTIONS:
            return out
    except ValidationError:
        log.warning("Dropping invalid UIAction %s", type(action).__name__)
    return ShowResults(product_ids=session.last_results, reason="Your current results").model_dump(mode="json")


def _event(session: Session, kind: str, model: BaseModel) -> str:
    if kind == "action":
        return sse("action", _safe_action(session, model))
    return sse("trace", model.model_dump(mode="json"))


# --- speech helpers ---------------------------------------------------------


def _two_sentences(text: str) -> str:
    return " ".join(split_sentences(text)[:2])


def template_speech(facts: list[dict[str, Any]]) -> str:
    """A safe sentence built only from tool results, for when the LLM's speech can't be used."""
    for f in reversed(facts):
        if "allowed" in f:
            if f["allowed"]:
                return f"The cart is staged for {tools.money(f['total'])}; review it on screen and sign to pay."
            return f"I can't stage that: {f['failed_checks'][0]}" if f.get("failed_checks") else "I can't stage that cart."
        if "tradeoffs" in f:
            return "The side-by-side comparison is on screen."
        if "tier" in f and "title" in f:
            if f.get("score") is None:
                return f"{f['title']} has too few reviews for a Trust Score."
            return f"{f['title']} has a Trust Score of {f['score']}, rated {f['tier']}."
        if "results" in f:
            if not f["results"]:
                return "I couldn't find anything that meets all of those requirements."
            top = f["results"][0]
            return f"I found {f['count']} options; the top match is {top['title']} at {tools.money(top['price'])}."
    return "The details on screen come straight from the catalog."


async def _speak(session: Session, speech: str, grounded: bool, source: str) -> AsyncIterator[str]:
    if not session.greeted:
        speech = f"{fallback.AI_DISCLOSURE} {speech}"
        session.greeted = True
    for sentence in split_sentences(speech):
        yield sse("say", {"text": sentence})
    yield sse("done", {"grounded": grounded, "source": source})


def _remember(session: Session, user_text: str, speech: str) -> None:
    session.chat_history = (session.chat_history + [
        {"role": "user", "content": user_text[:500]},
        {"role": "assistant", "content": speech[:500]},
    ])[-8:]


# --- fallback path ----------------------------------------------------------


async def _fallback_turn(session: Session, req: ChatRequest, reason: str) -> AsyncIterator[str]:
    try:
        turn = fallback.respond(session, req.text, req.ui_context)
    except Exception:
        log.exception("Fallback agent failed")
        yield sse("error", {"message": "The assistant hit an error; showing your current results."})
        turn = fallback.Turn(speech="Sorry, something went wrong on my side. Your current results are still on screen.")

    audit.append(session.audit, "turn", {"source": "fallback", "reason": reason, "tool_calls": turn.tool_calls})
    for kind, model in turn.events:
        yield _event(session, kind, model)

    speech, grounded = turn.speech, grounding.is_grounded(turn.speech, turn.facts, req.text)
    if not grounded:
        log.warning("Ungrounded numbers in fallback speech: %s", grounding.ungrounded(speech, turn.facts, req.text))
        speech = template_speech(turn.facts)
    _remember(session, req.text, speech)
    async for chunk in _speak(session, speech, grounded, "fallback"):
        yield chunk


# --- LLM path ---------------------------------------------------------------


@dataclass
class _LLMTurn:
    user_text: str
    facts: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    anomalies: list[str] = field(default_factory=list)
    emitted: int = 0
    stage_calls: int = 0


def _said_by_user(value: str, user_text: str) -> bool:
    """ASI06: profile values must come from the user's own words this turn."""
    stem = re.sub(r"[^a-z]", "", value.lower())[:5]
    words = re.sub(r"[^a-z ]", " ", user_text.lower())
    return bool(stem) and stem in words.replace(" ", "")


def _filter_profile_args(args: dict[str, Any], user_text: str) -> dict[str, Any]:
    out = dict(args)
    for key in ("needs", "avoid"):
        if isinstance(out.get(key), list):
            out[key] = [v for v in out[key] if isinstance(v, str) and _said_by_user(v, user_text) and not injection.is_suspicious(v)]
    if isinstance(out.get("skin_type"), str) and not _said_by_user(out["skin_type"], user_text):
        out.pop("skin_type")
    if out.get("budget_max") is not None and not grounding.extract_numbers(user_text):
        out.pop("budget_max")
    return out


def _blocked(state: _LLMTurn, rule: str, reason: str, anomalous: bool = True) -> tuple[dict, list[tuple[str, BaseModel]]]:
    if anomalous:
        state.anomalies.append(reason)
    return {"error": reason}, [("trace", PolicyTrace(rule=rule, passed=False, reason=reason))]


def _run_tool_call(session: Session, state: _LLMTurn, call: llm.ToolCall) -> tuple[dict, list[tuple[str, BaseModel]]]:
    """Runs one LLM-requested tool call with every guard applied. Returns (result for LLM, events)."""
    if call.name not in tools.REGISTRY:
        return _blocked(state, "tool_allowlist", f"Tool {call.name!r} does not exist.")
    if len(state.tool_calls) >= MAX_TOOL_CALLS:
        return _blocked(state, "tool_limit", f"Tool limit of {MAX_TOOL_CALLS} calls per turn reached.")
    try:
        args = json.loads(call.arguments or "{}")
        if not isinstance(args, dict):
            raise ValueError
    except ValueError:
        return _blocked(state, "tool_arguments", "Tool arguments were not a JSON object.", anomalous=False)

    if call.name == "stage_checkout":
        if state.stage_calls >= MAX_STAGE_CALLS:
            return _blocked(state, "stage_limit", "Only one cart proposal is allowed per turn.")
        if not fallback.explicit_yes(state.user_text):
            return _blocked(state, "explicit_consent", "The user has not explicitly asked to buy, so no cart was staged.")
        state.stage_calls += 1
    if call.name == "update_profile":
        args = _filter_profile_args(args, state.user_text)

    state.tool_calls.append({"name": call.name, "args": args})
    try:
        outcome = tools.call(session, call.name, args)
    except ValidationError as exc:
        return _blocked(state, "tool_arguments", f"Invalid arguments: {exc.errors()[0]['msg']}", anomalous=False)
    except ValueError as exc:
        return _blocked(state, "tool_arguments", str(exc), anomalous=False)

    if call.name == "stage_checkout" and not outcome.result.get("allowed"):
        state.anomalies.append("Proposed a cart that failed policy.")
    state.facts.append(outcome.result)
    events: list[tuple[str, BaseModel]] = [("trace", ToolTrace(name=call.name, args=args, ms=outcome.ms))]
    events += [("trace", t) for t in outcome.traces]
    events += [("action", a) for a in outcome.actions]
    return outcome.result, events


async def _llm_turn(session: Session, req: ChatRequest, client: llm.LLMClient, state: _LLMTurn) -> AsyncIterator[str]:
    s = get_settings()
    deadline = time.monotonic() + s.llm_turn_budget_s

    def timeout() -> float:
        remaining = deadline - time.monotonic()
        if remaining <= 0.5:
            raise llm.LLMError("Turn budget exhausted")
        return min(s.llm_timeout_s, remaining)

    visible = [i for i in req.ui_context.visible_ids if store.product(i)] or session.last_results
    focused = req.ui_context.focused_id if store.product(req.ui_context.focused_id or "") else session.focused_id
    if focused:
        session.focused_id = focused
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": prompts.SYSTEM},
        *session.chat_history[-6:],
        {"role": "user", "content": prompts.user_message(req.text, visible, focused, session.profile)},
    ]
    state.facts.append({"profile": session.profile.model_dump()})
    schemas = tools.openai_tool_schemas()

    speech = ""
    for _ in range(MAX_ROUNDS):
        comp = await client.complete(messages, schemas, timeout())
        if not comp.tool_calls:
            speech = comp.content
            break
        messages.append(comp.raw_message)
        for call in comp.tool_calls:
            result, events = _run_tool_call(session, state, call)
            for kind, model in events:
                state.emitted += kind == "action"
                yield _event(session, kind, model)
            messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result, default=str)})
    else:
        comp = await client.complete(messages, None, timeout())
        speech = comp.content

    speech = _two_sentences(speech)
    grounded = bool(speech) and grounding.is_grounded(speech, state.facts, req.text)
    if speech and not grounded:
        missing = grounding.ungrounded(speech, state.facts, req.text)
        log.info("Regrounding LLM speech; ungrounded numbers: %s", missing)
        messages += [{"role": "assistant", "content": speech},
                     {"role": "user", "content": prompts.REGROUND.format(missing=", ".join(f"{m:g}" for m in missing))}]
        try:
            speech = _two_sentences((await client.complete(messages, None, timeout())).content)
            grounded = bool(speech) and grounding.is_grounded(speech, state.facts, req.text)
        except llm.LLMError:
            grounded = False
    if not grounded:
        speech = template_speech(state.facts)

    breaker.success()
    _finish_llm_audit(session, state, "llm")
    _remember(session, req.text, speech)
    async for chunk in _speak(session, speech, grounded, "llm"):
        yield chunk


def _finish_llm_audit(session: Session, state: _LLMTurn, source: str) -> None:
    audit.append(session.audit, "turn", {"source": source, "tool_calls": state.tool_calls})
    if state.anomalies:
        session.anomalous_turns += 1
        audit.append(session.audit, "anomalous_turn", {"reasons": state.anomalies, "count": session.anomalous_turns})
        if session.anomalous_turns >= KILL_SWITCH_AFTER and not session.llm_killed:
            session.llm_killed = True
            audit.append(session.audit, "kill_switch", {"reason": f"{session.anomalous_turns} anomalous turns; fallback agent only"})


# --- entry point ------------------------------------------------------------


async def run_turn(session: Session, req: ChatRequest) -> AsyncIterator[str]:
    client = llm.client()
    if client is None:
        reason = "no_llm_key"
    elif session.llm_killed:
        reason = "kill_switch"
    elif not breaker.allow():
        reason = "circuit_open"
    else:
        state = _LLMTurn(user_text=req.text)
        try:
            async for chunk in _llm_turn(session, req, client, state):
                yield chunk
            return
        except Exception as exc:
            if isinstance(exc, llm.LLMError):
                breaker.failure()
                log.warning("LLM failed (%s); falling back", exc)
            else:
                log.exception("LLM turn crashed; falling back")
            if state.emitted:
                # Cards already moved on screen; finish from the tool results we have instead of
                # re-running the fallback agent and showing a second set of results.
                _finish_llm_audit(session, state, "llm_partial")
                speech = template_speech(state.facts)
                _remember(session, req.text, speech)
                async for chunk in _speak(session, speech, False, "llm"):
                    yield chunk
                return
            reason = "llm_error"
    async for chunk in _fallback_turn(session, req, reason):
        yield chunk
