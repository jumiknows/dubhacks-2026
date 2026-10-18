"""Bounded contracts for review analysis. Source claims are not authentication."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

Sentiment = Literal["positive", "negative", "mixed", "neutral", "unknown"]
Polarity = Literal["positive", "negative", "mixed", "neutral"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class ProductReference(_Model):
    source: str = Field(min_length=1, max_length=100)
    external_id: str = Field(min_length=1, max_length=200)
    merchant: str | None = Field(default=None, max_length=253)
    url: HttpUrl | None = None

    @field_validator("url")
    @classmethod
    def no_url_credentials(cls, value: HttpUrl | None) -> HttpUrl | None:
        if value is not None and (value.username or value.password):
            raise ValueError("URLs must not contain credentials")
        return value

    @property
    def identity(self) -> tuple[str, str, str | None]:
        return self.source.casefold(), self.external_id, self.merchant.casefold() if self.merchant else None


class ReviewInput(_Model):
    review_id: str = Field(min_length=1, max_length=200)
    product: ProductReference
    text: str = Field(default="", max_length=4000)
    title: str = Field(default="", max_length=300)
    rating: Decimal | None = Field(default=None, ge=0, le=100, max_digits=12, decimal_places=8)
    rating_scale: Decimal = Field(default=Decimal("5"), gt=0, le=100, max_digits=12, decimal_places=8)
    published_at: str | None = Field(default=None, max_length=64)
    source_url: HttpUrl | None = None
    verified_purchase: bool | None = None

    @field_validator("source_url")
    @classmethod
    def no_url_credentials(cls, value: HttpUrl | None) -> HttpUrl | None:
        return ProductReference.no_url_credentials(value)

    @field_validator("rating", "rating_scale", mode="before")
    @classmethod
    def no_boolean_ratings(cls, value: Any) -> Any:
        if isinstance(value, bool):
            raise ValueError("Ratings must be numbers, not booleans")
        return value

    @model_validator(mode="after")
    def rating_in_range(self) -> "ReviewInput":
        if self.rating is not None and self.rating > self.rating_scale:
            raise ValueError("Rating exceeds its declared scale")
        return self

    @property
    def full_text(self) -> str:
        return f"{self.title}. {self.text}" if self.title and self.text else self.title or self.text


class ReviewAnalysisRequest(_Model):
    product: ProductReference
    reviews: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    provenance: Literal["uploaded", "live", "demo"] = "uploaded"
    retrieved_at: datetime | None = None
    reported_total: int | None = Field(default=None, ge=0, le=1_000_000_000)
    sample_selection: Literal["unknown", "recent", "highest", "lowest", "mixed", "all_available"] = "unknown"
    max_examples: int = Field(default=3, ge=1, le=10)

    @field_validator("retrieved_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError("retrieved_at must include a timezone")
        return value


class NormalizedReview(_Model):
    review_id: str
    product: ProductReference
    text: str
    title: str
    rating_five: Decimal | None
    published_at: str | None
    date_precision: Literal["date", "datetime"] | None
    source_url: HttpUrl | None
    verified_purchase: bool | None
    input_index: int

    @property
    def full_text(self) -> str:
        return f"{self.title}. {self.text}" if self.title and self.text else self.title or self.text


class ReviewIssue(_Model):
    index: int | None = None
    review_id: str | None = None
    code: str
    detail: str


class DuplicateReview(_Model):
    review_id: str
    duplicate_of: str
    kind: Literal["id", "exact_text", "near_text"]


class ReviewSecurityFlag(_Model):
    review_id: str
    kind: Literal["prompt_injection"] = "prompt_injection"
    patterns: list[str]


class PreparedReviews(_Model):
    records: list[NormalizedReview] = Field(default_factory=list)
    issues: list[ReviewIssue] = Field(default_factory=list)
    duplicates: list[DuplicateReview] = Field(default_factory=list)
    security_flags: list[ReviewSecurityFlag] = Field(default_factory=list)
    received_count: int


class AspectLabel(_Model):
    aspect: str = Field(min_length=1, max_length=60)
    polarity: Polarity
    evidence: str = Field(min_length=1, max_length=500)


class ReviewClassification(_Model):
    review_id: str = Field(min_length=1, max_length=200)
    sentiment: Sentiment
    aspects: list[AspectLabel] = Field(default_factory=list, max_length=12)
    evidence_quotes: list[str] = Field(default_factory=list, max_length=3)

    @field_validator("evidence_quotes")
    @classmethod
    def bounded_quotes(cls, quotes: list[str]) -> list[str]:
        if any(not q.strip() or len(q) > 500 for q in quotes):
            raise ValueError("Evidence quotes must be nonempty and at most 500 characters")
        return quotes


class ReviewExample(_Model):
    review_id: str
    title: str
    excerpt: str
    rating_five: float | None
    published_at: str | None
    source_url: HttpUrl | None
    sentiment: Sentiment


class AspectEvidence(_Model):
    review_id: str
    quote: str
    polarity: Polarity


class AspectSummary(_Model):
    aspect: str
    mention_count: int
    sentiment_counts: dict[str, int]
    review_ids: list[str]
    evidence: list[AspectEvidence]


class RatingSummary(_Model):
    count: int
    missing_count: int
    mean_five: float | None
    histogram_five: dict[str, int]
    histogram_method: str = "Each declared rating is scaled to 0–5, then rounded half-up for histogram bins."


class SentimentSummary(_Model):
    counts: dict[str, int]
    classified_count: int
    balance: float | None
    balance_definition: str = "100 × (positive − negative) / classified; mixed and neutral count in the denominator; unknown excluded."
    interpretation: str = "Sample opinion balance, not product quality, authenticity, or a calibrated probability."


class HeuristicSignal(_Model):
    key: str
    count: int
    review_ids: list[str]
    detail: str


class ReviewAnalysis(_Model):
    product: ProductReference
    provenance: Literal["uploaded", "live", "demo"]
    retrieved_at: datetime | None
    analyzed_at: datetime
    received_count: int
    analyzed_count: int
    reported_total: int | None
    sample_selection: str
    dated_count: int
    recent_window_days: int = 30
    recent_count: int
    ratings: RatingSummary
    sentiment: SentimentSummary
    classification_method: Literal["deterministic", "llm", "hybrid"]
    classifications: list[ReviewClassification]
    highest_rated: list[ReviewExample]
    lowest_rated: list[ReviewExample]
    newest: list[ReviewExample]
    recurring_aspects: list[AspectSummary]
    issues: list[ReviewIssue]
    duplicates: list[DuplicateReview]
    security_flags: list[ReviewSecurityFlag]
    heuristic_signals: list[HeuristicSignal]
    limitations: list[str]
