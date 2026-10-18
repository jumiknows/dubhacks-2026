"""Additive review API. No product scores, checkout, or merchant approval writes."""

from __future__ import annotations

import asyncio
import time
from collections import deque
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from api.agent import llm
from api.config import get_settings
from api.reviews.analysis import analyze_reviews, prepare_reviews
from api.reviews.classifier import ReviewClassificationError, classify_reviews
from api.reviews.demo import demo_request
from api.reviews.models import ProductReference, ReviewAnalysisRequest
from api.reviews.sources import ReviewSourceService

router = APIRouter(prefix="/reviews", tags=["review insights"])
_model_slots = asyncio.Semaphore(2)
_model_attempts: deque[float] = deque()


def _reserve_model_budget() -> bool:
    """A process-local rolling budget; no awaits between checking and reserving."""
    clock = time.monotonic()
    while _model_attempts and clock - _model_attempts[0] >= 86400:
        _model_attempts.popleft()
    settings = get_settings()
    recent = sum(clock - value < 60 for value in _model_attempts)
    if recent >= settings.review_llm_requests_per_minute or len(_model_attempts) >= settings.review_llm_requests_per_day:
        return False
    _model_attempts.append(clock)
    return True


class UploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product: ProductReference
    reviews: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    reported_total: int | None = Field(default=None, ge=0, le=1_000_000_000)
    sample_selection: Literal["unknown", "recent", "highest", "lowest", "mixed", "all_available"] = "unknown"
    max_examples: int = Field(default=3, ge=1, le=10)
    use_llm: bool = False


class FetchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product: ProductReference
    limit: int = Field(default=50, ge=1, le=100)
    use_llm: bool = False


class DemoOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    use_llm: bool = False


@lru_cache(maxsize=1)
def source_service() -> ReviewSourceService:
    settings = get_settings()
    return ReviewSourceService(
        settings.review_woocommerce_stores,
        timeout_s=settings.review_source_timeout_s,
        cache_ttl_s=settings.review_source_cache_ttl_s,
    )


async def analyze_request(request: ReviewAnalysisRequest, *, use_llm: bool = False) -> dict:
    prepared = prepare_reviews(request)
    labels = None
    classification = {
        "requested": use_llm, "status": "disabled", "llm_classified_count": 0,
        "fallback_count": len(prepared.records), "warnings": [],
    }
    if use_llm and prepared.records:
        if llm.client() is None:
            classification.update(status="not_configured", warnings=["No model is configured; deterministic analysis was used."])
        else:
            acquired = False
            try:
                # Avoid queuing an unlimited number of credit-consuming calls.
                await asyncio.wait_for(_model_slots.acquire(), timeout=.1)
                acquired = True
                if not _reserve_model_budget():
                    classification.update(status="rate_limited", warnings=["The review AI request budget has been reached; deterministic analysis was used."])
                    report = analyze_reviews(request, prepared=prepared)
                    report.limitations.extend(classification["warnings"])
                    return {"analysis": report.model_dump(mode="json"), "classification": classification, "summary": _summary(report)}
                settings = get_settings()
                batch = await classify_reviews(
                    prepared.records, timeout_s=settings.review_llm_timeout_s,
                    max_reviews=settings.review_llm_max_reviews,
                )
                labels = batch.classifications
                classification.update(
                    status="completed" if batch.llm_classified_count == len(prepared.records) else "partial", llm_classified_count=batch.llm_classified_count,
                    fallback_count=len(prepared.records) - batch.llm_classified_count,
                    skipped_review_ids=batch.skipped_review_ids, warnings=batch.warnings,
                )
            except asyncio.TimeoutError:
                classification.update(status="busy", warnings=["Model capacity is busy; deterministic analysis was used."])
            except ReviewClassificationError:
                # Provider details can contain prompts/credentials: expose neither.
                classification.update(status="fallback", warnings=["Model analysis was unavailable or failed evidence validation; deterministic analysis was used."])
            finally:
                if acquired:
                    _model_slots.release()
    elif use_llm:
        classification["status"] = "empty"

    report = analyze_reviews(request, prepared=prepared, classifications=labels)
    if report.provenance == "uploaded":
        report.limitations.append("The upload's collection time, claimed total, and sampling method have not been independently verified.")
    report.limitations.extend(classification["warnings"])
    return {
        "analysis": report.model_dump(mode="json"),
        "classification": classification,
        "summary": _summary(report),
    }


def _summary(report) -> str:
    if not report.analyzed_count:
        return "No distinct valid reviews are available. Sentiment and customer opinions are unknown."
    counts = report.sentiment.counts
    rating = f"Mean supplied rating: {report.ratings.mean_five}/5." if report.ratings.mean_five is not None else "Star ratings are unavailable."
    return (
        f"Analyzed {report.analyzed_count} distinct valid reviews from {report.received_count} supplied records: "
        f"{counts['positive']} positive, {counts['negative']} negative, {counts['mixed']} mixed, "
        f"{counts['neutral']} neutral, {counts['unknown']} unknown. {rating} "
        f"{report.recent_count} dated reviews fall within the last {report.recent_window_days} days. "
        "These findings describe this sample, not every customer or the product's authenticity."
    )


@router.get("/sources")
def sources() -> dict:
    configured = source_service().list_sources()
    return {
        "sources": configured,
        "configured": bool(configured),
        "note": "Configure REVIEW_WOOCOMMERCE_STORES to fetch written reviews from specific public stores. Store configuration is not merchant verification. Amazon, Walmart, and Target review retrieval is not implemented.",
    }


@router.get("/products")
async def products(
    merchant: str = Query(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$"),
    q: str = Query(min_length=1, max_length=120),
    limit: int = Query(default=5, ge=1, le=5),
) -> dict:
    return await source_service().search_products(merchant, q, limit=limit)


@router.post("/analyze")
async def analyze(req: UploadRequest) -> dict:
    # The client cannot promote uploaded data into authenticated live provenance.
    request = ReviewAnalysisRequest(
        product=req.product, reviews=req.reviews, provenance="uploaded",
        reported_total=req.reported_total, sample_selection=req.sample_selection,
        max_examples=req.max_examples,
    )
    return {"source": {"status": "uploaded", "freshness_verified": False}, **await analyze_request(request, use_llm=req.use_llm)}


@router.post("/fetch")
async def fetch(req: FetchRequest) -> dict:
    # URL is output-only metadata: the adapter builds requests from server config.
    result = await source_service().fetch_reviews(
        req.product.source, req.product.external_id, req.product.merchant, limit=req.limit,
    )
    payload = result.pop("analysis_request", None)
    if payload is None:
        return {"source": result, "analysis": None, "classification": None, "summary": "Review evidence is unavailable; no sentiment or trust finding was invented."}
    output = await analyze_request(ReviewAnalysisRequest.model_validate(payload), use_llm=req.use_llm)
    return {"source": result, **output}


@router.post("/demo")
async def demo(req: DemoOptions = DemoOptions()) -> dict:
    return {
        "source": {"status": "demo", "is_mock": True, "note": "Synthetic test reviews, not live shoppers."},
        **await analyze_request(demo_request(), use_llm=req.use_llm),
    }


@router.get("/workbench", include_in_schema=False)
def workbench() -> FileResponse:
    return FileResponse(Path(__file__).with_name("workbench.html"), media_type="text/html", headers={"Cache-Control": "no-store"})
