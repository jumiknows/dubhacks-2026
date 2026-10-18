"""Detects text that tries to instruct an AI assistant (prompt injection).

Used on review text in the trust pipeline, on catalog strings at load time,
and on new profile entries. Pattern-based on purpose: deterministic and auditable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (name, re.compile(rx, re.IGNORECASE))
    for name, rx in [
        ("ignore_instructions", r"\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|all|your)\b.{0,20}\b(instructions?|prompts?|rules?|directions?)"),
        ("addresses_ai", r"\b(ai|a\.i\.|llm|chat ?bot|language model|shopping assistant|virtual assistant|assistant)\s*[,:]\s*(please\s+)?(you must|always|recommend|say|tell|rank|ignore|only)"),
        ("ai_directive", r"\b(if you are|as an?)\s+(an?\s+)?(ai|llm|language model|assistant)\b"),
        ("role_marker", r"(^|\s)(system|assistant|user)\s*:|<\|?(im_start|im_end|system|endoftext)\|?>|\[/?(inst|system)\]"),
        ("new_instructions", r"\b(new|updated|real|actual)\s+(instructions?|system prompt|directives?)\b"),
        ("hidden_prompt", r"<!--.*?-->|​|‌|‍|⁠"),
        ("act_as", r"\b(you are now|pretend (to be|you are)|act as|roleplay as|jailbreak|developer mode)\b"),
        ("ranking_manipulation", r"\b(recommend|rank|rate)\s+(this|it)\s+(product\s+)?(first|highest|as (the )?(best|#1|number one))"),
    ]
]


@dataclass(frozen=True)
class InjectionHit:
    pattern: str
    excerpt: str


def scan(text: str) -> list[InjectionHit]:
    hits: list[InjectionHit] = []
    for name, rx in _PATTERNS:
        m = rx.search(text)
        if m:
            start = max(0, m.start() - 20)
            hits.append(InjectionHit(name, text[start : m.end() + 40].strip()[:160]))
    return hits


def is_suspicious(text: str) -> bool:
    return bool(scan(text))
