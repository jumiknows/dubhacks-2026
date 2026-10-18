"""Paths and the frozen experiment definition."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPERIMENT_FILE = ROOT / "experiment.json"
ARTIFACTS = Path(os.environ.get("RESEARCH_ARTIFACTS", ROOT / "artifacts"))
RAW = ARTIFACTS / "raw"
INTERIM = ARTIFACTS / "interim"
RUNS = ARTIFACTS / "runs"
RESULTS = ROOT / "results"


def experiment() -> dict:
    return json.loads(EXPERIMENT_FILE.read_text())


def experiment_hash() -> str:
    return hashlib.sha256(EXPERIMENT_FILE.read_bytes()).hexdigest()


def load_env() -> None:
    """Read research/.env (gitignored) without overriding the real environment."""
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())
