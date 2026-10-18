from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Purpose = Literal["fetch", "link", "checkout"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MerchantRegistration(Model):
    """Operator-maintained identity mapping, not proof of business legitimacy."""

    origins: list[str] = Field(default_factory=list, max_length=20)
    checkout_url: str | None = Field(default=None, max_length=4096)
    payment_origins: list[str] = Field(default_factory=list, max_length=10)


class WebsiteRequest(Model):
    url: str = Field(min_length=1, max_length=4096)
    merchant_id: str | None = Field(default=None, min_length=1, max_length=100, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
    purpose: Purpose = "link"


class Evidence(Model):
    code: str
    status: Literal["pass", "warning", "fail", "unknown"]
    detail: str


class ReputationResult(Model):
    provider: str
    status: Literal["known_malicious", "no_known_threat", "reported", "unknown"]
    checked_at: datetime
    expires_at: datetime | None = None
    threat_types: list[str] = Field(default_factory=list)
    detail: str
    cache_hit: bool = False


class WebsiteAssessment(Model):
    decision: Literal["blocked", "hold", "allowed"]
    allowed: bool
    purpose: Purpose
    merchant_id: str | None
    # Display origin only: never echo credentials, secret query values, or fragments.
    origin: str | None
    url_sha256: str
    checked_at: datetime
    expires_at: datetime | None = None
    identity: Literal["approved_destination", "unrecognized", "mismatch", "invalid"]
    reputation: Literal["known_malicious", "no_known_threat", "reported", "unknown"]
    evidence: list[Evidence]
    providers: list[ReputationResult]
    summary: str
    limitations: list[str]
    safety_guaranteed: Literal[False] = False


class CanonicalURL(Model):
    url: str
    origin: str
    host: str
    warning_codes: list[str] = Field(default_factory=list)
