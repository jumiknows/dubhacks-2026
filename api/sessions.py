"""In-memory session store. No accounts, no personal data, 1-hour inactivity TTL."""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field

from fastapi import HTTPException

from api.config import get_settings
from api.schemas import IntentMandate, PreferenceProfile


@dataclass
class StagedCart:
    cart_hash: str
    cart_payload: str
    total: float
    product_id: str
    paid: bool = False


@dataclass
class Session:
    id: str
    created: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    profile: PreferenceProfile = field(default_factory=PreferenceProfile)
    public_key_jwk: dict[str, str] | None = None
    intent_mandate: IntentMandate | None = None
    mandate_id: str | None = None
    staged: dict[str, StagedCart] = field(default_factory=dict)
    spent: float = 0.0
    audit: list[dict] = field(default_factory=list)
    greeted: bool = False
    last_results: list[str] = field(default_factory=list)
    last_query: str = ""
    focused_id: str | None = None
    anomalous_turns: int = 0
    used_nonces: set[str] = field(default_factory=set)
    demo_private_key: object | None = None  # only with DEMO_SERVER_SIGNING=true


class SessionStore:
    def __init__(self, ttl_s: int) -> None:
        self._ttl = ttl_s
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    def create(self) -> Session:
        with self._lock:
            self._sweep()
            s = Session(id=secrets.token_urlsafe(16))
            self._sessions[s.id] = s
            return s

    def get(self, session_id: str) -> Session:
        """Returns a live session or raises 404. Touching it extends the TTL."""
        with self._lock:
            self._sweep()
            s = self._sessions.get(session_id)
            if s is None:
                raise HTTPException(status_code=404, detail="Unknown or expired session")
            s.last_seen = time.time()
            return s

    def count(self) -> int:
        with self._lock:
            self._sweep()
            return len(self._sessions)

    def _sweep(self) -> None:
        cutoff = time.time() - self._ttl
        for sid in [k for k, s in self._sessions.items() if s.last_seen < cutoff]:
            del self._sessions[sid]


sessions = SessionStore(get_settings().session_ttl_s)
