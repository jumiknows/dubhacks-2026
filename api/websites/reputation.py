"""Fixed HTTPS threat providers. No target browsing, redirects, or error-body logs."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from api.websites.models import ReputationResult


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.utcoffset() is not None else None
    except (ValueError, OverflowError):
        return None


def _boolean(value: Any) -> bool | None:
    if type(value) is bool:
        return value
    if isinstance(value, str):
        if value.lower() in {"y", "yes", "true"}:
            return True
        if value.lower() in {"n", "no", "false"}:
            return False
    return None


class ReputationClient:
    def __init__(self, *, webrisk_key: str = "", phishtank_enabled: bool = False,
                 phishtank_key: str = "", timeout_s: float = 5,
                 transport: httpx.AsyncBaseTransport | None = None):
        self._webrisk_key = webrisk_key
        self._phishtank_enabled = phishtank_enabled
        self._phishtank_key = phishtank_key
        self._timeout = min(10.0, max(.1, timeout_s))
        self._transport = transport

    def configuration(self) -> list[dict]:
        return [
            {"provider": "web_risk", "configured": bool(self._webrisk_key), "uses_https": True,
             "threat_categories": ["social_engineering", "malware", "unwanted_software"]},
            {"provider": "phishtank", "configured": self._phishtank_enabled, "uses_https": True,
             "threat_categories": ["reported_phishing"]},
        ]

    async def _json(self, method: str, endpoint: str, **kwargs) -> tuple[dict | None, str | None]:
        try:
            async with asyncio.timeout(self._timeout), httpx.AsyncClient(
                timeout=self._timeout, transport=self._transport, follow_redirects=False,
                trust_env=False, limits=httpx.Limits(max_connections=2),
            ) as client:
                async with client.stream(method, endpoint, headers={
                    "Accept": "application/json", "Accept-Encoding": "identity",
                    "User-Agent": "phishtank/conjure-website-safety",
                    **kwargs.pop("headers", {}),
                }, **kwargs) as response:
                    if response.status_code in (429, 509):
                        return None, "Threat provider rate limit reached; no safety clearance was issued."
                    if response.status_code != 200:
                        return None, "Threat provider unavailable or refused the request; no safety clearance was issued."
                    if "json" not in response.headers.get("content-type", "").lower():
                        return None, "Threat provider returned an unsupported response."
                    if response.headers.get("content-encoding", "identity").lower() != "identity":
                        return None, "Threat provider returned unsupported compressed data."
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        data.extend(chunk)
                        if len(data) > 65536:
                            return None, "Threat provider response exceeded the permitted size."
                    def unique(pairs):
                        out = {}
                        for key, value in pairs:
                            if key in out:
                                raise ValueError("duplicate field")
                            out[key] = value
                        return out
                    def invalid_constant(_):
                        raise ValueError("non-finite JSON")
                    parsed = json.loads(data, object_pairs_hook=unique, parse_constant=invalid_constant)
                    return (parsed, None) if isinstance(parsed, dict) else (None, "Threat provider response has an unexpected shape.")
        except (httpx.HTTPError, TimeoutError, ValueError, UnicodeError, RecursionError):
            return None, "Threat lookup failed or timed out; no safety clearance was issued."

    async def _web_risk(self, url: str) -> ReputationResult:
        checked = utcnow()
        data, error = await self._json(
            "GET", "https://webrisk.googleapis.com/v1/uris:search",
            headers={"X-Goog-Api-Key": self._webrisk_key},
            params=[("uri", url), ("threatTypes", "SOCIAL_ENGINEERING"), ("threatTypes", "MALWARE"), ("threatTypes", "UNWANTED_SOFTWARE")],
        )
        if data == {} and error is None:
            return ReputationResult(provider="web_risk", status="no_known_threat", checked_at=checked,
                expires_at=checked + timedelta(minutes=5), detail="No requested threat-list match was returned; this is not merchant verification.")
        threat = data.get("threat") if data else None
        if isinstance(threat, dict):
            types, expires = threat.get("threatTypes"), _time(threat.get("expireTime"))
            if isinstance(types, list) and types and all(isinstance(x, str) and x in {"SOCIAL_ENGINEERING", "MALWARE", "UNWANTED_SOFTWARE"} for x in types) and expires and expires > checked:
                return ReputationResult(provider="web_risk", status="known_malicious", checked_at=checked,
                    expires_at=expires, threat_types=sorted(set(types)), detail="URL matched an active threat-list entry.")
        return ReputationResult(provider="web_risk", status="unknown", checked_at=checked,
            detail=error or "Threat provider returned incomplete or expired evidence.")

    async def _phishtank(self, url: str) -> ReputationResult:
        checked = utcnow()
        body = {"url": url, "format": "json"}
        if self._phishtank_key:
            body["app_key"] = self._phishtank_key
        data, error = await self._json("POST", "https://checkurl.phishtank.com/checkurl/", data=body)
        if data and isinstance(data.get("meta"), dict) and data["meta"].get("status", "success") != "success":
            data, error = None, "PhishTank did not return a successful lookup."
        result = data.get("results") if data else None
        if isinstance(result, dict) and (result.get("url") is None or result.get("url") == url):
            present = _boolean(result.get("in_database"))
            verified, valid = _boolean(result.get("verified")), _boolean(result.get("valid"))
            if present is False and result.get("url") == url and verified is not True and valid is not True:
                return ReputationResult(provider="phishtank", status="no_known_threat", checked_at=checked,
                    expires_at=checked + timedelta(minutes=5), detail="URL was not found in PhishTank; unreported threats remain possible.")
            if present is True and result.get("url") == url and verified is True and valid is True:
                return ReputationResult(provider="phishtank", status="known_malicious", checked_at=checked,
                    expires_at=checked + timedelta(minutes=5), threat_types=["PHISHING"], detail="URL matched a verified valid phishing report.")
            if present is True:
                return ReputationResult(provider="phishtank", status="reported", checked_at=checked,
                    expires_at=checked + timedelta(minutes=1), detail="A report exists without a current verified-valid verdict; manual review is required.")
        return ReputationResult(provider="phishtank", status="unknown", checked_at=checked,
            detail=error or "PhishTank returned incomplete evidence or a mismatched URL.")

    async def check(self, url: str) -> list[ReputationResult]:
        jobs = []
        if self._webrisk_key:
            jobs.append(self._web_risk(url))
        if self._phishtank_enabled:
            jobs.append(self._phishtank(url))
        return list(await asyncio.gather(*jobs)) if jobs else []
