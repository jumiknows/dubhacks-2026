"""Checks that every number in assistant speech appears in this turn's tool results.

Normalizes $38, 38.00, 38% and fractions (0.38 in a tool result grounds "38%").
Numbers the user said this turn are also allowed, so echoing "under $40" is fine.
"""

from __future__ import annotations

import re
from typing import Any

_NUM = re.compile(r"(?<![\w.])\$?(\d+(?:,\d{3})*(?:\.\d+)?)(\s*%)?")


def extract_numbers(text: str) -> list[float]:
    return [float(m.group(1).replace(",", "")) for m in _NUM.finditer(text)]


def _collect(obj: Any, out: set[float]) -> None:
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        out.add(round(float(obj), 2))
        if 0 <= obj <= 1:
            out.add(float(round(obj * 100)))
        return
    if isinstance(obj, str):
        out.update(round(n, 2) for n in extract_numbers(obj))
        return
    if isinstance(obj, dict):
        for v in obj.values():
            _collect(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _collect(v, out)


def grounded_numbers(facts: list[Any], user_text: str = "") -> set[float]:
    out: set[float] = set()
    _collect(facts, out)
    out.update(round(n, 2) for n in extract_numbers(user_text))
    return out


def ungrounded(speech: str, facts: list[Any], user_text: str = "") -> list[float]:
    """Numbers in `speech` that no tool result (or the user) supplied."""
    known = grounded_numbers(facts, user_text)
    return [n for n in extract_numbers(speech) if not any(abs(n - k) < 0.006 for k in known)]


def is_grounded(speech: str, facts: list[Any], user_text: str = "") -> bool:
    return not ungrounded(speech, facts, user_text)
