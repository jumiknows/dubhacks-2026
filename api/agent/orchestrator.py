"""Runs one chat turn and streams it as Server-Sent Events.

Order: `action` events as soon as each tool returns, then `say` (one per sentence), then `done`.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, AsyncIterator

from pydantic import BaseModel, TypeAdapter, ValidationError

from api.agent import fallback
from api.guard import audit, grounding
from api.schemas import ChatRequest, ShowResults, UIAction
from api.sessions import Session

log = logging.getLogger(__name__)

_ACTION = TypeAdapter(UIAction)
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'$])")


def sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE.split(text.strip()) if s.strip()]


def validate_action(action: BaseModel | dict) -> dict:
    """Round-trip every action through the UIAction schema. Invalid -> ValidationError."""
    raw = action.model_dump() if isinstance(action, BaseModel) else action
    return _ACTION.validate_python(raw).model_dump(mode="json")


def _safe_actions(session: Session, actions: list[BaseModel]) -> list[dict]:
    out = []
    for a in actions:
        try:
            out.append(validate_action(a))
        except ValidationError:
            log.warning("Dropping invalid UIAction %s", type(a).__name__)
            out.append(ShowResults(product_ids=session.last_results, reason="Your current results").model_dump(mode="json"))
    return out


def _template_speech(turn: fallback.Turn) -> str:
    return "Here's what I found; the details on screen come straight from the catalog."


async def run_turn(session: Session, req: ChatRequest) -> AsyncIterator[str]:
    source = "fallback"
    try:
        turn = fallback.respond(session, req.text, req.ui_context)
    except Exception:
        log.exception("Fallback agent failed")
        yield sse("error", {"message": "The assistant hit an error; showing your current results."})
        turn = fallback.Turn(speech="Sorry, something went wrong on my side. Your current results are still on screen.")

    audit.append(session.audit, "turn", {"source": source, "tool_calls": turn.tool_calls})
    for action in _safe_actions(session, turn.actions):
        yield sse("action", action)

    speech = turn.speech
    grounded = grounding.is_grounded(speech, turn.facts, req.text)
    if not grounded:
        log.warning("Ungrounded numbers in speech: %s", grounding.ungrounded(speech, turn.facts, req.text))
        speech, grounded = _template_speech(turn), True
    if not session.greeted:
        speech = f"{fallback.AI_DISCLOSURE} {speech}"
        session.greeted = True

    for sentence in split_sentences(speech):
        yield sse("say", {"text": sentence})
    yield sse("done", {"grounded": grounded, "source": source})
