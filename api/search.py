"""Product search and ranking.

fit = 0.45 * semantic + 0.25 * attribute_match + 0.20 * trust + 0.10 * feedback

Hard filters (budget, avoid attributes, unverified merchants under a verified-only
mandate, requested subcategory, dismissed items) remove products before scoring.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable

import numpy as np

from api import nlu
from api.schemas import FitTerms, IntentMandate, PreferenceProfile, Product, RankedProduct
from api.store import Store
from api.textvec import hashed_matrix

log = logging.getLogger(__name__)

W_SEMANTIC, W_ATTR, W_TRUST, W_FEEDBACK = 0.45, 0.25, 0.20, 0.10


def _make_embedder() -> tuple[str, Callable[[list[str]], np.ndarray]]:
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore

        model = SentenceTransformer("all-MiniLM-L6-v2")
        return "sentence-transformers", lambda texts: model.encode(texts, normalize_embeddings=True)
    except Exception as exc:  # not installed, or no network to download the model
        log.info("sentence-transformers unavailable (%s); using hashed n-gram vectors.", type(exc).__name__)
        return "hashed-ngrams", hashed_matrix


def product_text(p: Product) -> str:
    a = p.attributes
    bits = [p.title, p.brand, p.subcategory, p.summary, f"for {str(a.get('skin_type', '')).replace(',', ' ')} skin"]
    if a.get("fragrance_free"):
        bits.append("fragrance-free unscented")
    if a.get("hydrating"):
        bits.append("hydrating moisture")
    if a.get("spf"):
        bits.append(f"spf {a['spf']} sun protection")
    if a.get("key_ingredient"):
        bits.append(str(a["key_ingredient"]))
    return ". ".join(bits)


@dataclass
class SearchRequest:
    query: str = ""
    max_price: float | None = None
    limit: int = 6
    subcategory: str | None = None


class Ranker:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.backend, self._embed = _make_embedder()
        self.ids = list(store.products)
        self._index = {pid: i for i, pid in enumerate(self.ids)}
        self.vectors = self._embed([product_text(store.products[pid]) for pid in self.ids]) if self.ids else None

    # --- filters ----------------------------------------------------------

    def _filter_reason(
        self, p: Product, budget: float | None, profile: PreferenceProfile,
        mandate: IntentMandate | None, subcategory: str | None,
    ) -> str | None:
        """The first hard filter that removes `p`, or None if it stays."""
        if subcategory and p.subcategory != subcategory:
            return "subcategory"
        if budget is not None and p.price > budget:
            return "budget"
        if any(nlu.violates_avoid(p, a) for a in profile.avoid):
            return "avoid"
        if mandate and mandate.verified_only and not self.store.merchant_verified(p.merchant_id):
            return "unverified"
        if p.id in {d.id for d in profile.dismissed}:
            return "dismissed"
        return None

    # --- terms ------------------------------------------------------------

    def _semantic(self, query: str, cand_idx: list[int]) -> np.ndarray:
        if not query.strip() or self.vectors is None:
            return np.full(len(cand_idx), 0.5)
        q = self._embed([query])[0]
        sims = np.clip(self.vectors[cand_idx] @ q, 0, None)
        top = sims.max() if len(sims) else 0
        return sims / top if top > 0 else np.full(len(cand_idx), 0.5)

    def _attribute(self, p: Product, profile: PreferenceProfile) -> tuple[float, list[str]]:
        wanted_skin = [s for s in (profile.skin_type or "").split(",") if s]
        checks: list[tuple[str, bool]] = [(f"{s} skin", s in nlu.product_skin_types(p)) for s in wanted_skin]
        checks += [(nlu.need_label(n), nlu.meets_need(p, n)) for n in profile.needs]
        if "fragrance" in profile.avoid:
            checks.append(("fragrance-free", True))  # hard filter already guarantees it
        if not checks:
            return 0.5, []
        matched = [label for label, ok in checks if ok]
        return len(matched) / len(checks), matched

    def _trust(self, pid: str) -> float:
        r = self.store.trust_report(pid)
        if r is None or r.tier == "insufficient" or r.score is None:
            return 0.5
        return r.score / 100

    def _feedback(self, ci: int, profile: PreferenceProfile) -> float:
        if self.vectors is None:
            return 0.5
        liked = [self._index[i] for i in profile.liked_ids if i in self._index]
        disliked = [self._index[d.id] for d in profile.dismissed if d.id in self._index]
        if not liked and not disliked:
            return 0.5
        v = self.vectors[ci]
        like = float((self.vectors[liked] @ v).max()) if liked else 0.0
        dis = float((self.vectors[disliked] @ v).max()) if disliked else 0.0
        return float(np.clip(0.5 + 0.5 * (like - dis), 0, 1))

    # --- reasons ----------------------------------------------------------

    def _reasons(self, pid: str, terms: FitTerms, matched: list[str]) -> list[str]:
        r = self.store.trust_report(pid)
        if r is None or r.score is None:
            trust_reason = "Too few reviews for a Trust Score yet"
        else:
            trust_reason = f"Trust Score {r.score} ({r.tier})"
        options = [
            (W_ATTR * terms.attribute_match, f"Matches {', '.join(matched)}" if matched else ""),
            (W_TRUST * terms.trust, trust_reason),
            (W_SEMANTIC * terms.semantic, "Strong match for your search" if terms.semantic >= 0.8 else ""),
            (W_FEEDBACK * terms.feedback, "Similar to items you liked" if terms.feedback > 0.6 else ""),
        ]
        ranked = [text for _, text in sorted(options, key=lambda x: -x[0]) if text]
        return ranked[:2]

    # --- main -------------------------------------------------------------

    def search(
        self, req: SearchRequest, profile: PreferenceProfile | None = None,
        mandate: IntentMandate | None = None,
    ) -> list[RankedProduct]:
        return self.search_with_stats(req, profile, mandate)[0]

    def search_with_stats(
        self, req: SearchRequest, profile: PreferenceProfile | None = None,
        mandate: IntentMandate | None = None,
    ) -> tuple[list[RankedProduct], dict[str, int]]:
        """Results plus how many products each hard filter removed."""
        profile = profile or PreferenceProfile()
        budget_opts = [b for b in (req.max_price, profile.budget_max) if b is not None]
        budget = min(budget_opts) if budget_opts else None
        removed: dict[str, int] = {}
        cands = []
        for pid in self.ids:
            why = self._filter_reason(self.store.products[pid], budget, profile, mandate, req.subcategory)
            if why:
                removed[why] = removed.get(why, 0) + 1
            else:
                cands.append(pid)
        if not cands:
            return [], removed
        cand_idx = [self._index[pid] for pid in cands]
        semantic_q = " ".join([req.query, *profile.needs, (profile.skin_type or "").replace(",", " ")])
        sem = self._semantic(semantic_q, cand_idx)

        results: list[RankedProduct] = []
        for j, pid in enumerate(cands):
            p = self.store.products[pid]
            attr, matched = self._attribute(p, profile)
            terms = FitTerms(
                semantic=round(float(sem[j]), 3), attribute_match=round(attr, 3),
                trust=round(self._trust(pid), 3), feedback=round(self._feedback(cand_idx[j], profile), 3),
            )
            fit = W_SEMANTIC * terms.semantic + W_ATTR * terms.attribute_match + W_TRUST * terms.trust + W_FEEDBACK * terms.feedback
            results.append(
                RankedProduct(**p.model_dump(), fit_percent=round(100 * fit), reasons=self._reasons(pid, terms, matched), fit_terms=terms)
            )
        results.sort(key=lambda r: (-r.fit_percent, r.price))
        return results[: max(1, min(req.limit, 50))], removed


_ranker: Ranker | None = None


def init(store: Store) -> Ranker:
    global _ranker
    _ranker = Ranker(store)
    return _ranker


def ranker() -> Ranker:
    assert _ranker is not None, "search.init() not called"
    return _ranker
