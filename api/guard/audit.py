"""Append-only, hash-chained audit log (one per session).

hash = sha256(prev_hash + canonical(data)); the first entry chains from GENESIS.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

GENESIS = "0" * 64


def canonical(data: Any) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _hash(prev_hash: str, data: dict) -> str:
    return hashlib.sha256((prev_hash + canonical(data)).encode()).hexdigest()


def append(log: list[dict], kind: str, data: dict[str, Any]) -> dict:
    prev = log[-1]["hash"] if log else GENESIS
    payload = {"kind": kind, **data}
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": kind,
        "data": payload,
        "prev_hash": prev,
        "hash": _hash(prev, payload),
    }
    log.append(entry)
    return entry


def verify(log: list[dict]) -> bool:
    prev = GENESIS
    for entry in log:
        if entry["prev_hash"] != prev or entry["hash"] != _hash(prev, entry["data"]):
            return False
        if entry["data"].get("kind") != entry["kind"]:
            return False
        prev = entry["hash"]
    return True
