"""Bounded sample analysis; no fetching, autonomous purchases, or product ranker.

All findings describe the supplied sample. Heuristics are not fraud findings.
Untrusted review prose is never executed or promoted into model instructions.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from pydantic import ValidationError

from api.guard import injection
from api.trust.pipeline import _NEG, _NEGATORS, _POS, sentiment as existing_sentiment
from api.reviews.models import (
    AspectEvidence, AspectLabel, AspectSummary, DuplicateReview, HeuristicSignal,
    NormalizedReview, PreparedReviews, RatingSummary, ReviewAnalysis,
    ReviewAnalysisRequest, ReviewClassification, ReviewExample, ReviewInput,
    ReviewIssue, ReviewSecurityFlag, SentimentSummary,
)

_LABELS = ("positive", "negative", "mixed", "neutral", "unknown")
_COPY_GUARD_TERMS = {
    "long", "short", "died", "dies", "failed", "failure", "working", "stopped",
    "uncomfortable", "loud", "quiet", "quick", "slow", "fast", "heavy", "light",
    "late", "early", "damaged", "intact", "poor", "reliable", "unreliable",
}
_ASPECTS = {
    "battery life": r"\bbatter(?:y|ies)\b",
    "sound quality": r"\b(sound|audio|bass|speaker)\b",
    "comfort": r"\b(comfort\w*|ear cushions?|fit)\b",
    "durability": r"\b(durab\w*|broke|broken|flimsy|sturdy)\b",
    "price": r"\b(price|expensive|cheap|value|cost)\b",
    "delivery": r"\b(delivery|shipping|shipped|arrived)\b",
    "packaging": r"\b(packaging|package|box)\b",
    "skin irritation": r"\b(irritat\w*|rash|burning|breakouts?)\b",
    "texture": r"\b(texture|greasy|sticky|smooth)\b",
}


def _utc(now: datetime | None) -> datetime:
    value = now or datetime.now(timezone.utc)
    if value.utcoffset() is None:
        raise ValueError("Analysis clock must include a timezone")
    return value.astimezone(timezone.utc)


def _date(value: str | None, cutoff: datetime) -> tuple[str | None, str | None, str | None]:
    if not value:
        return None, None, None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            parsed_date = date.fromisoformat(value)
            if parsed_date > cutoff.date():
                return None, None, "future_date"
            return parsed_date.isoformat(), "date", None
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.utcoffset() is None:
            return None, None, "timezone_missing"
        parsed = parsed.astimezone(timezone.utc)
        if parsed > cutoff:
            return None, None, "future_date"
        return parsed.isoformat().replace("+00:00", "Z"), "datetime", None
    except (ValueError, OverflowError):
        return None, None, "invalid_date"


def _text_key(text: str) -> str:
    return " ".join(re.findall(r"\w+", unicodedata.normalize("NFKC", text).casefold()))


def _opinion_signature(text: str) -> tuple:
    """Preserve recognized negation and sentiment edits when considering copies."""
    words = re.findall(r"\w+(?:'\w+)?", text.casefold().replace("’", "'"))
    negation = tuple(word for word in words if word in _NEGATORS)
    terms = []
    for index, word in enumerate(words):
        sign = 1 if word in _POS else -1 if word in _NEG else 0
        if sign:
            # Position relative to negators matters, not just presence of 'not'.
            if any(previous in _NEGATORS for previous in words[max(0, index - 3):index]):
                sign *= -1
            terms.append((word, sign))
    facts = tuple(word for word in words if word in _COPY_GUARD_TERMS or any(character.isdigit() for character in word))
    return negation, tuple(terms), facts


def prepare_reviews(request: ReviewAnalysisRequest, *, now: datetime | None = None) -> PreparedReviews:
    """Validate each row; reject identity mismatch; retain missing dates as unknown.

    Duplicate text is conservatively excluded from sample counts, not called fake.
    Near-copy checks are bounded by the 200-row request cap and use token sets.
    """
    clock = _utc(now)
    cutoff = min(request.retrieved_at.astimezone(timezone.utc), clock) if request.retrieved_at else clock
    result = PreparedReviews(received_count=len(request.reviews))
    if request.retrieved_at and request.retrieved_at > clock:
        result.issues.append(ReviewIssue(code="future_retrieval_time", detail="Future retrieval time is not accepted as evidence of freshness."))
    ids: set[str] = set()
    text_keys: dict[str, str] = {}
    token_sets: list[tuple[str, set[str], Decimal | None, tuple]] = []
    for index, raw in enumerate(request.reviews):
        try:
            row = ReviewInput.model_validate(raw)
        except ValidationError:
            # Do not echo arbitrary malformed payloads, URLs, or credentials.
            result.issues.append(ReviewIssue(index=index, code="invalid_review", detail="Review failed the bounded input schema; check identity, rating, text length, and URL format."))
            continue
        if row.product.identity != request.product.identity:
            result.issues.append(ReviewIssue(index=index, review_id=row.review_id, code="product_mismatch", detail="Review does not match the requested source, merchant, and product ID."))
            continue
        if row.review_id in ids:
            result.duplicates.append(DuplicateReview(review_id=row.review_id, duplicate_of=row.review_id, kind="id"))
            continue
        ids.add(row.review_id)
        text_key = _text_key(row.full_text)
        if text_key and text_key in text_keys:
            result.duplicates.append(DuplicateReview(review_id=row.review_id, duplicate_of=text_keys[text_key], kind="exact_text"))
            continue
        tokens = set(text_key.split())
        scaled_rating = row.rating / row.rating_scale * 5 if row.rating is not None else None
        signature = _opinion_signature(row.full_text)
        near = next((rid for rid, previous, previous_rating, previous_signature in token_sets if len(tokens) >= 12 and len(previous) >= 12 and scaled_rating == previous_rating and signature == previous_signature and len(tokens & previous) / len(tokens | previous) >= .95), None)
        if near:
            result.duplicates.append(DuplicateReview(review_id=row.review_id, duplicate_of=near, kind="near_text"))
            continue
        if text_key:
            text_keys[text_key] = row.review_id
            token_sets.append((row.review_id, tokens, scaled_rating, signature))
        published_at, precision, problem = _date(row.published_at, cutoff)
        if problem:
            result.issues.append(ReviewIssue(index=index, review_id=row.review_id, code=problem, detail="Publication date is unavailable for recency calculations; no date was inferred."))
        hits = injection.scan(row.full_text)
        if hits:
            result.security_flags.append(ReviewSecurityFlag(review_id=row.review_id, patterns=sorted({hit.pattern for hit in hits})))
        result.records.append(NormalizedReview(
            review_id=row.review_id, product=row.product, text=row.text, title=row.title,
            rating_five=scaled_rating,
            published_at=published_at, date_precision=precision, source_url=row.source_url,
            verified_purchase=row.verified_purchase, input_index=index,
        ))
    return result


def _polarity(text: str) -> str:
    """Existing sentiment scorer plus explicit mixed-word detection; ambiguous != neutral."""
    words = re.findall(r"[\w]+(?:['’][\w]+)?", text.casefold().replace("’", "'"))
    signs = set()
    for index, word in enumerate(words):
        sign = 1 if word in _POS else -1 if word in _NEG else 0
        if index and words[index - 1] in _NEGATORS:
            sign *= -1
        if sign:
            signs.add(sign)
    if signs == {-1, 1}:
        return "mixed"
    score = existing_sentiment(text)
    if score >= .2:
        return "positive"
    if score <= -.2:
        return "negative"
    return "unknown"


def _clauses(text: str) -> list[str]:
    return [part.strip() for match in re.finditer(r"[^.!?;\n]+[.!?;]?", text) for part in re.split(r"\b(?:but|however|although)\b", match.group(), flags=re.I) if part.strip()]


def _support_quotes(text: str, label: str, clauses: list[str]) -> list[str]:
    """Find exact bounded opinion spans, rather than an unrelated leading excerpt.

    Mixed labels seek support for both polarities. A long clause is windowed
    around recognized sentiment terms, then through bounded overlapping windows
    for VADER-only vocabulary. No supporting span means abstaining, not quoting
    unrelated text as evidence.
    """
    if label == "unknown":
        return []
    targets = ("positive", "negative") if label == "mixed" else (label,)
    quotes = []
    for target in targets:
        selected = None
        for clause in clauses:
            if len(clause) <= 500:
                candidates = [clause]
            else:
                # Keep enough preceding context to retain nearby negation.
                words = list(re.finditer(r"\w+(?:'\w+)?", clause.casefold().replace("’", "'")))
                starts = []
                for index, match in enumerate(words):
                    word = match.group()
                    sign = 1 if word in _POS else -1 if word in _NEG else 0
                    if index and words[index - 1].group() in _NEGATORS:
                        sign *= -1
                    if sign == (1 if target == "positive" else -1):
                        starts.append(max(0, min(len(clause) - 500, match.start() - 160)))
                starts.extend(range(0, len(clause), 250))
                candidates = [clause[start:start + 500].strip() for start in dict.fromkeys(starts)]
            selected = next((quote for quote in candidates if quote in text and _polarity(quote) in {target, "mixed"}), None)
            if selected:
                break
        if not selected:
            return []
        if selected not in quotes:
            quotes.append(selected)
    return quotes[:3]


def _fallback(record: NormalizedReview, quarantined: bool) -> ReviewClassification:
    if quarantined or not record.full_text:
        return ReviewClassification(review_id=record.review_id, sentiment="unknown")
    label = _polarity(record.full_text)
    aspects = []
    clauses = _clauses(record.full_text)
    evidence_quotes = _support_quotes(record.full_text, label, clauses)
    if label != "unknown" and not evidence_quotes:
        label = "unknown"
    for aspect, pattern in _ASPECTS.items():
        clause = next((part for part in clauses if re.search(pattern, part, re.I)), None)
        if clause and len(clause) <= 500:
            polarity = _polarity(clause)
            if polarity != "unknown":
                aspects.append(AspectLabel(aspect=aspect, polarity=polarity, evidence=clause))
    return ReviewClassification(
        review_id=record.review_id, sentiment=label, aspects=aspects,
        evidence_quotes=evidence_quotes,
    )


def _instant(record: NormalizedReview) -> datetime:
    if record.date_precision == "date":
        return datetime.combine(date.fromisoformat(record.published_at), datetime.min.time(), tzinfo=timezone.utc)
    return datetime.fromisoformat(record.published_at.replace("Z", "+00:00"))


def _example(record: NormalizedReview, classification: ReviewClassification) -> ReviewExample:
    return ReviewExample(
        review_id=record.review_id, title=record.title, excerpt=record.full_text[:500],
        rating_five=float(record.rating_five) if record.rating_five is not None else None,
        published_at=record.published_at, source_url=record.source_url, sentiment=classification.sentiment,
    )


def analyze_reviews(
    request: ReviewAnalysisRequest,
    *, classifications: list[ReviewClassification] | None = None,
    now: datetime | None = None,
    analysis_method: str = "deterministic",
    prepared: PreparedReviews | None = None,
) -> ReviewAnalysis:
    """Analyze the validated, deduplicated sample; classifications need exact evidence.

    ``prepared`` is an internal optimization, not a public API input. Its product
    binding is checked again. Unknown/malformed model labels fall back safely.
    """
    clock = _utc(now)
    data = prepared or prepare_reviews(request, now=clock)
    if data.received_count != len(request.reviews) or any(row.product.identity != request.product.identity for row in data.records):
        raise ValueError("Prepared records do not match this request")
    issues = list(data.issues)
    records = data.records
    by_id = {row.review_id: row for row in records}
    quarantined = {flag.review_id for flag in data.security_flags}
    supplied: dict[str, ReviewClassification] = {}
    invalid_ids: set[str] = set()
    for item in classifications or []:
        try:
            item = ReviewClassification.model_validate(item)
        except ValidationError:
            issues.append(ReviewIssue(code="invalid_classification", detail="A model classification failed its schema and was ignored."))
            continue
        row = by_id.get(item.review_id)
        if item.review_id in supplied or item.review_id in invalid_ids:
            supplied.pop(item.review_id, None)
            invalid_ids.add(item.review_id)
            issues.append(ReviewIssue(review_id=item.review_id, code="duplicate_classification", detail="Repeated model labels were ignored for this review."))
            continue
        if row is None:
            issues.append(ReviewIssue(review_id=item.review_id, code="unknown_classification_id", detail="Model label refers to an unknown or excluded review."))
            continue
        quotes = item.evidence_quotes + [aspect.evidence for aspect in item.aspects]
        if any(quote not in row.full_text for quote in quotes) or (item.sentiment != "unknown" and not item.evidence_quotes):
            issues.append(ReviewIssue(review_id=item.review_id, code="unsupported_classification", detail="Model label lacks exact supporting evidence and was ignored."))
            invalid_ids.add(item.review_id)
            continue
        supplied[item.review_id] = item
    final = {
        row.review_id: supplied[row.review_id] if row.review_id in supplied and row.review_id not in quarantined else _fallback(row, row.review_id in quarantined)
        for row in records
    }
    used_model = sum(row.review_id in supplied and row.review_id not in quarantined for row in records)
    method = "deterministic" if not used_model else "llm" if used_model == len(records) else "hybrid"
    if analysis_method not in {"deterministic", "gemini", "llm", "hybrid"}:
        raise ValueError("Unknown analysis method")
    ratings = [row.rating_five for row in records if row.rating_five is not None]
    histogram = {str(star): 0 for star in range(6)}
    for rating in ratings:
        histogram[str(int(rating.quantize(Decimal("1"), rounding=ROUND_HALF_UP)))] += 1
    counts = {label: 0 for label in _LABELS}
    for item in final.values():
        counts[item.sentiment] += 1
    classified = len(records) - counts["unknown"]
    dated = [row for row in records if row.published_at is not None]
    # Date-only records retain their precision; comparing calendar days avoids
    # pretending a source supplied an exact publication time.
    recent = [row for row in dated if (date.fromisoformat(row.published_at) >= (clock - timedelta(days=30)).date() if row.date_precision == "date" else _instant(row) >= clock - timedelta(days=30))]
    grouped: dict[str, dict[str, AspectLabel]] = defaultdict(dict)
    mismatches = []
    for row in records:
        label = final[row.review_id]
        if row.rating_five is not None and ((row.rating_five >= 4 and label.sentiment == "negative") or (row.rating_five <= 2 and label.sentiment == "positive")):
            mismatches.append(row.review_id)
        for aspect in label.aspects:
            key = " ".join(aspect.aspect.casefold().split())
            # One review contributes at most once per aspect, even if a model repeats it.
            previous = grouped[key].get(row.review_id)
            if previous and previous.polarity != aspect.polarity:
                grouped[key][row.review_id] = AspectLabel(aspect=key, polarity="mixed", evidence=previous.evidence)
            else:
                grouped[key][row.review_id] = aspect
    summaries = []
    for aspect, evidence in grouped.items():
        if len(evidence) < 2:
            continue
        polarities = Counter(item.polarity for item in evidence.values())
        summaries.append(AspectSummary(
            aspect=aspect, mention_count=len(evidence),
            sentiment_counts={label: polarities[label] for label in _LABELS[:-1]},
            review_ids=list(evidence),
            evidence=[AspectEvidence(review_id=rid, quote=item.evidence, polarity=item.polarity) for rid, item in list(evidence.items())[:request.max_examples]],
        ))
    summaries.sort(key=lambda item: (-item.mention_count, item.aspect))
    rated = sorted((row for row in records if row.rating_five is not None), key=lambda row: (-row.rating_five, row.input_index))
    lowest = sorted(rated, key=lambda row: (row.rating_five, row.input_index))
    newest = sorted(dated, key=lambda row: (_instant(row), -row.input_index), reverse=True)
    limitations = [
        "Findings describe only the analyzed sample; they do not establish all customers' opinions or live inventory.",
        "Verified-purchase labels are source or merchant assertions, not independent proof that a review is authentic.",
        "Sentiment and anomaly signals are heuristics, not proof that a review is genuine or fake.",
        "Highest, lowest, and newest examples are selected from this sample and can overlap; they are not additional independent reviews.",
    ]
    if request.provenance == "demo":
        limitations.append("DEMO: the supplied reviews are synthetic demonstration data, not live customer evidence.")
    if request.provenance == "uploaded":
        limitations.append("Uploaded fields and source URLs are not independently authenticated; client claims do not establish source provenance.")
    if request.sample_selection != "all_available":
        limitations.append(f"Sample selection is {request.sample_selection}; selection bias may affect ratings and sentiment.")
    if request.reported_total is None or request.reported_total != len(records):
        limitations.append("Complete review coverage has not been established; reported totals, when supplied, are source claims.")
    if request.reported_total is not None and request.reported_total < len(request.reviews):
        issues.append(ReviewIssue(code="inconsistent_total", detail="Reported total is smaller than the supplied review count."))
    if len(records) < 10:
        limitations.append("Small sample: fewer than ten distinct valid reviews; avoid strong generalizations.")
    if method != "llm":
        limitations.append("Some or all text uses the existing deterministic English sentiment scorer; sarcasm, languages, and subtle aspect opinions may be missed. Ambiguous text remains unknown.")
    if data.duplicates:
        limitations.append("Exact and near-duplicate text was conservatively excluded from counts; repeated text can be legitimate and is not proof of fraud.")
    if len(dated) < len(records):
        limitations.append("Missing, invalid, timezone-less, and future publication dates are excluded from recency calculations.")
    signals = [
        HeuristicSignal(key="duplicate_candidates", count=len(data.duplicates), review_ids=[item.review_id for item in data.duplicates], detail="Repeated IDs or exact/near-copy text excluded from sample counts; not an authenticity verdict."),
        HeuristicSignal(key="rating_text_disagreement", count=len(mismatches), review_ids=mismatches, detail="Strong star/text disagreement may reflect sarcasm, rating error, or classifier error; not proof of deception."),
        HeuristicSignal(key="prompt_injection", count=len(quarantined), review_ids=sorted(quarantined), detail="Instruction-like review text is quarantined from language classification and aspect extraction; ratings remain source claims."),
    ]
    return ReviewAnalysis(
        product=request.product, provenance=request.provenance,
        retrieved_at=request.retrieved_at if not request.retrieved_at or request.retrieved_at <= clock else None,
        analyzed_at=clock, received_count=len(request.reviews), analyzed_count=len(records), reported_total=request.reported_total,
        sample_selection=request.sample_selection, dated_count=len(dated), recent_count=len(recent),
        ratings=RatingSummary(count=len(ratings), missing_count=len(records) - len(ratings), mean_five=float((sum(ratings) / len(ratings)).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)) if ratings else None, histogram_five=histogram),
        sentiment=SentimentSummary(counts=counts, classified_count=classified, balance=round(100 * (counts["positive"] - counts["negative"]) / classified, 2) if classified else None),
        classification_method=method, classifications=list(final.values()),
        highest_rated=[_example(row, final[row.review_id]) for row in rated[:request.max_examples]],
        lowest_rated=[_example(row, final[row.review_id]) for row in lowest[:request.max_examples]],
        newest=[_example(row, final[row.review_id]) for row in newest[:request.max_examples]],
        recurring_aspects=summaries, issues=issues, duplicates=data.duplicates,
        security_flags=data.security_flags, heuristic_signals=signals, limitations=limitations,
    )
