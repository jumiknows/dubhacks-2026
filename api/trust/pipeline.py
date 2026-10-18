"""Offline trust pipeline: product catalog + reviews -> trust_reports.json.

Run:  python -m api.trust.pipeline --catalog api/data/catalog.json --reviews api/data/reviews.jsonl

Input adapters are pluggable (see ADAPTERS). Every number in a report is computed
here; the LLM only ever sees the resulting `detail` and `top_reasons` strings.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable

import numpy as np

from api.guard import injection
from api.schemas import SecurityFlag, TrustReport, TrustSignal
from api.textvec import hashed_matrix

WEEK_MS = 7 * 24 * 3600 * 1000
MIN_REVIEWS = 25
DUP_THRESHOLD = 0.92
WEIGHTS: dict[str, float] = {
    "velocity": 0.25,
    "duplicates": 0.20,
    "verified": 0.20,
    "consistency": 0.20,
    "distribution": 0.15,
}


@dataclass(frozen=True)
class Review:
    review_id: str
    product_id: str
    rating: float
    title: str
    text: str
    user_id: str
    ts_ms: int
    verified: bool | None  # None when the source has no such field
    helpful: int = 0

    @property
    def full_text(self) -> str:
        return f"{self.title}. {self.text}".strip(". ")


def _review_id(*parts: object) -> str:
    return "r_" + hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:12]


# --- Input adapters -------------------------------------------------------


def load_amazon_jsonl(path: Path) -> list[Review]:
    """Amazon Reviews 2023 format: rating, title, text, asin, parent_asin, user_id,
    timestamp (ms), verified_purchase, helpful_vote."""
    reviews = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            pid = r.get("parent_asin") or r["asin"]
            reviews.append(
                Review(
                    review_id=_review_id(r["user_id"], pid, r["timestamp"]),
                    product_id=pid,
                    rating=float(r["rating"]),
                    title=r.get("title", ""),
                    text=r.get("text", ""),
                    user_id=r["user_id"],
                    ts_ms=int(r["timestamp"]),
                    verified=bool(r.get("verified_purchase", False)),
                    helpful=int(r.get("helpful_vote", 0)),
                )
            )
    return reviews


def load_sephora_csv(path: Path) -> list[Review]:
    """Sephora Products and Skincare Reviews (Kaggle) reviews_*.csv files.
    TODO(verify): column names below match the public dataset as we know it;
    check against the downloaded files. The dataset has no verified-purchase
    field, so `verified` is None and that signal is dropped and re-weighted."""
    reviews = []
    with open(path, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            ts = datetime.fromisoformat(r["submission_time"]).replace(tzinfo=timezone.utc)
            ts_ms = int(ts.timestamp() * 1000)
            reviews.append(
                Review(
                    review_id=_review_id(r["author_id"], r["product_id"], ts_ms),
                    product_id=r["product_id"],
                    rating=float(r["rating"]),
                    title=r.get("review_title") or "",
                    text=r.get("review_text") or "",
                    user_id=r["author_id"],
                    ts_ms=ts_ms,
                    verified=None,
                    helpful=int(float(r.get("total_pos_feedback_count") or 0)),
                )
            )
    return reviews


ADAPTERS: dict[str, Callable[[Path], list[Review]]] = {
    "amazon": load_amazon_jsonl,
    "sephora": load_sephora_csv,
}


# --- Sentiment ------------------------------------------------------------

_POS = {
    "love", "loved", "great", "amazing", "perfect", "best", "soft", "smooth", "gentle",
    "hydrated", "hydrating", "soothing", "calm", "calmer", "glowing", "excellent",
    "recommend", "favorite", "favourite", "happy", "nice", "good", "works", "lovely",
    "plump", "comfortable", "holy", "staple", "repurchase", "wonderful", "fantastic",
}
_NEG = {
    "hate", "hated", "terrible", "awful", "worst", "broke", "breakout", "breakouts",
    "burn", "burned", "burning", "stung", "sting", "itchy", "rash", "greasy", "sticky",
    "waste", "disappointed", "disappointing", "returned", "return", "irritated",
    "irritation", "redness", "bad", "useless", "smells", "peeling", "pilled", "pilling",
    "refund", "regret", "horrible", "tight", "flaky",
}
_NEGATORS = {"not", "no", "never", "didn't", "doesn't", "isn't", "wasn't", "don't", "without"}


def _lexicon_sentiment(text: str) -> float:
    words = [w.strip(".,!?;:()\"'") for w in text.lower().split()]
    score = 0
    for i, w in enumerate(words):
        polarity = 1 if w in _POS else -1 if w in _NEG else 0
        if polarity and i > 0 and words[i - 1] in _NEGATORS:
            polarity = -polarity
        score += polarity
    return max(-1.0, min(1.0, score / 3))


def _make_sentiment() -> Callable[[str], float]:
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer  # type: ignore

        analyzer = SentimentIntensityAnalyzer()
        return lambda text: analyzer.polarity_scores(text)["compound"]
    except ImportError:
        return _lexicon_sentiment


sentiment = _make_sentiment()


def _agrees(stars: float, polarity: float) -> bool:
    if stars >= 4:
        return polarity >= -0.05
    if stars <= 2:
        return polarity <= 0.05
    return True


# --- Signals --------------------------------------------------------------


def _linear(value: float, healthy_at: float, zero_at: float) -> float:
    """1.0 at or below healthy_at, falling linearly to 0.0 at zero_at."""
    if value <= healthy_at:
        return 1.0
    return max(0.0, 1.0 - (value - healthy_at) / (zero_at - healthy_at))


def _pct(x: float) -> int:
    return round(100 * x)


@dataclass
class _Burst:
    ratio: float
    max_count: int
    median_weekly: float
    start_ms: int
    end_ms: int

    @property
    def is_burst(self) -> bool:
        return self.ratio > 3


def _burst(ts_sorted: list[int]) -> _Burst:
    weekly = Counter(t // WEEK_MS for t in ts_sorted)
    median = float(statistics.median(weekly.values()))
    best, best_start, lo = 0, ts_sorted[0], 0
    for hi, t in enumerate(ts_sorted):
        while t - ts_sorted[lo] >= WEEK_MS:
            lo += 1
        if hi - lo + 1 > best:
            best, best_start = hi - lo + 1, ts_sorted[lo]
    return _Burst(best / median, best, median, best_start, best_start + WEEK_MS)


def _signals(
    reviews: list[Review], sims: np.ndarray, burst: _Burst, agree: list[bool]
) -> list[TrustSignal]:
    n = len(reviews)
    signals: list[TrustSignal] = []

    burst_share = burst.max_count / n
    signals.append(
        TrustSignal(
            key="velocity",
            value=round(burst.ratio, 2),
            subscore=round(_linear(burst.ratio, 3, 10), 3),
            detail=(
                f"{_pct(burst_share)}% of reviews arrived in one 7-day window "
                f"({burst.max_count} of {n}; a typical week has {burst.median_weekly:g})."
            ),
        )
    )

    nn = sims.max(axis=1) if n > 1 else np.zeros(n)
    dup_share = float((nn >= DUP_THRESHOLD).mean()) if n else 0.0
    signals.append(
        TrustSignal(
            key="duplicates",
            value=round(dup_share, 3),
            subscore=round(1 - min(1.0, dup_share / 0.20), 3),
            detail=f"{_pct(dup_share)}% of reviews are near-duplicates of another review.",
        )
    )

    if any(r.verified is not None for r in reviews):
        ver_share = sum(1 for r in reviews if r.verified) / n
        signals.append(
            TrustSignal(
                key="verified",
                value=round(ver_share, 3),
                subscore=round(ver_share, 3),
                detail=f"{_pct(ver_share)}% of reviews are from verified purchases.",
            )
        )

    agree_share = sum(agree) / n
    signals.append(
        TrustSignal(
            key="consistency",
            value=round(agree_share, 3),
            subscore=round(agree_share, 3),
            detail=f"{_pct(agree_share)}% of reviews have text that matches their star rating.",
        )
    )

    p5 = sum(1 for r in reviews if r.rating >= 5) / n
    signals.append(
        TrustSignal(
            key="distribution",
            value=round(p5, 3),
            subscore=round(_linear(p5, 0.70, 0.95), 3),
            detail=f"{_pct(p5)}% of reviews are 5 stars.",
        )
    )
    return signals


def _score(signals: list[TrustSignal]) -> int:
    total_w = sum(WEIGHTS[s.key] for s in signals)
    return round(100 * sum(WEIGHTS[s.key] * s.subscore for s in signals) / total_w)


def _tier(score: int) -> str:
    return "trusted" if score >= 75 else "mixed" if score >= 50 else "caution"


_WEAK_LABEL = {
    "velocity": "Review burst",
    "duplicates": "Repeated text",
    "verified": "Few verified buyers",
    "consistency": "Stars don't match text",
    "distribution": "Unusually many 5-star reviews",
}
_STRONG_LABEL = {
    "velocity": "Steady review pace",
    "duplicates": "Reviews are written independently",
    "verified": "Mostly verified buyers",
    "consistency": "Stars match what reviewers wrote",
    "distribution": "Natural spread of ratings",
}


def _top_reasons(signals: list[TrustSignal], flagged: bool) -> list[str]:
    weak = sorted((s for s in signals if s.subscore < 0.75), key=lambda s: s.subscore)
    if weak:
        reasons = [f"{_WEAK_LABEL[s.key]}: {s.detail}" for s in weak[:3]]
    else:
        strong = sorted(signals, key=lambda s: (-s.subscore, -WEIGHTS[s.key]))
        reasons = [f"{_STRONG_LABEL[s.key]}: {s.detail}" for s in strong[:2]]
    if flagged:
        reasons.insert(
            0,
            "A review contains text aimed at AI assistants; its instructions are not followed, "
            "but it still contributes to review statistics. This product is capped at caution.",
        )
    return reasons[:3]


def _adjusted_rating(
    reviews: list[Review], sims: np.ndarray, burst: _Burst
) -> tuple[float, set[int]]:
    """Weighted mean of stars. Returns (rating, indices of duplicates-after-first)."""
    order = sorted(range(len(reviews)), key=lambda i: reviews[i].ts_ms)
    seen: list[int] = []
    dup_after_first: set[int] = set()
    total = weight_sum = 0.0
    for i in order:
        r = reviews[i]
        if seen and sims[i, seen].max() >= DUP_THRESHOLD:
            w = 0.0
            dup_after_first.add(i)
        elif not r.verified and r.verified is not None:
            in_burst = burst.is_burst and burst.start_ms <= r.ts_ms < burst.end_ms
            w = 0.4 if in_burst else 0.7
        else:
            w = 1.0
        seen.append(i)
        total += w * r.rating
        weight_sum += w
    return (round(total / weight_sum, 1) if weight_sum else 0.0), dup_after_first


def _security_flags(reviews: list[Review]) -> list[SecurityFlag]:
    flags = []
    for r in reviews:
        hits = injection.scan(r.full_text)
        if hits:
            flags.append(SecurityFlag(review_id=r.review_id, excerpt=hits[0].excerpt))
    return flags


def compute_report(product_id: str, reviews: list[Review], seeded: bool = False) -> TrustReport:
    n = len(reviews)
    listed = round(sum(r.rating for r in reviews) / n, 1) if n else 0.0
    flags = _security_flags(reviews)
    if n == 0:
        return TrustReport(
            product_id=product_id, score=None, tier="insufficient", rating_listed=0.0,
            rating_adjusted=0.0, signals=[], top_reasons=["No reviews yet."],
            evidence_review_ids=[], security_flags=[], seeded_for_demo=seeded,
        )

    matrix = hashed_matrix([r.full_text for r in reviews])
    sims = matrix @ matrix.T
    np.fill_diagonal(sims, -1.0)
    burst = _burst(sorted(r.ts_ms for r in reviews))
    agree = [_agrees(r.rating, sentiment(r.full_text)) for r in reviews]
    signals = _signals(reviews, sims, burst, agree)
    adjusted, dup_idx = _adjusted_rating(reviews, sims, burst)

    evidence: list[str] = [f.review_id for f in flags]
    if burst.is_burst:
        evidence += [r.review_id for r in reviews if burst.start_ms <= r.ts_ms < burst.end_ms]
    evidence += [reviews[i].review_id for i in sorted(dup_idx)]
    evidence += [r.review_id for r, ok in zip(reviews, agree) if not ok]
    evidence = list(dict.fromkeys(evidence))[:12]

    if n < MIN_REVIEWS:
        return TrustReport(
            product_id=product_id, score=None, tier="insufficient", rating_listed=listed,
            rating_adjusted=adjusted, signals=signals,
            top_reasons=[f"Only {n} reviews, fewer than the {MIN_REVIEWS} needed for a Trust Score."]
            + (["A review contains text aimed at AI assistants; its instructions are not followed, "
                "but it still contributes to review statistics."] if flags else []),
            evidence_review_ids=evidence, security_flags=flags, seeded_for_demo=seeded,
        )

    score = _score(signals)
    tier = _tier(score)
    if flags and tier in ("trusted", "mixed"):
        tier, score = "caution", min(score, 49)
    return TrustReport(
        product_id=product_id, score=score, tier=tier, rating_listed=listed,
        rating_adjusted=adjusted, signals=signals, top_reasons=_top_reasons(signals, bool(flags)),
        evidence_review_ids=evidence, security_flags=flags, seeded_for_demo=seeded,
    )


def build_reports(products: Iterable[dict], reviews: list[Review]) -> list[TrustReport]:
    """`products` are catalog dicts; an optional `seeded_for_demo` key marks seeded red flags."""
    by_product: dict[str, list[Review]] = defaultdict(list)
    for r in reviews:
        by_product[r.product_id].append(r)
    return [
        compute_report(p["id"], by_product.get(p["id"], []), bool(p.get("seeded_for_demo")))
        for p in products
    ]


def run(catalog_path: Path, reviews_path: Path, out_path: Path, adapter: str = "amazon") -> list[TrustReport]:
    products = json.loads(catalog_path.read_text())
    reviews = ADAPTERS[adapter](reviews_path)
    reports = build_reports(products, reviews)
    out_path.write_text(json.dumps([r.model_dump() for r in reports], indent=2))
    return reports


def main() -> None:
    from api.config import DATA_DIR

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--catalog", type=Path, default=DATA_DIR / "catalog.json")
    ap.add_argument("--reviews", type=Path, default=DATA_DIR / "reviews.jsonl")
    ap.add_argument("--out", type=Path, default=DATA_DIR / "trust_reports.json")
    ap.add_argument("--adapter", choices=sorted(ADAPTERS), default="amazon")
    args = ap.parse_args()
    reports = run(args.catalog, args.reviews, args.out, args.adapter)
    print(f"Wrote {len(reports)} trust reports to {args.out}")


if __name__ == "__main__":
    main()
