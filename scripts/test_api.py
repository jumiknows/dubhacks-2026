"""Offline test entry point; fails if the shared demo fixtures change."""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
for name in ("LLM_API_KEY", "ELEVENLABS_API_KEY", "STRIPE_SECRET_KEY", "WEBSITE_WEBRISK_API_KEY", "WEBSITE_PHISHTANK_API_KEY"):
    os.environ[name] = ""
os.environ["DEMO_SERVER_SIGNING"] = "false"
os.environ["WEBSITE_PHISHTANK_ENABLED"] = "false"
os.environ["WEBSITE_MERCHANTS"] = "{}"
os.environ["WEBSITE_BLOCKED_HOSTS"] = "[]"
os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"


def fixture_hashes() -> dict[str, str]:
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (ROOT / "api" / "data").rglob("*") if p.is_file()}


if __name__ == "__main__":
    import pytest

    required = ("catalog.json", "merchants.json", "trust_reports.json")
    if any(not (ROOT / "api" / "data" / name).is_file() for name in required):
        raise SystemExit("Shared demo fixtures are missing; refusing automatic regeneration during tests.")
    before = fixture_hashes()
    result = pytest.main(["-q", "-p", "no:cacheprovider", *(sys.argv[1:] or ["api/tests"])])
    after = fixture_hashes()
    changed = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
    if changed:
        print("ERROR: shared fixtures changed during tests:", ", ".join(changed))
        raise SystemExit(1)
    print("Shared demo fixtures unchanged.")
    raise SystemExit(result)
