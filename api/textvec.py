"""Text vectors shared by search and the trust pipeline.

Hashed character n-gram TF vectors in NumPy. No model download, deterministic,
good enough for near-duplicate detection and 150-product semantic search.
"""

from __future__ import annotations

import re
import zlib

import numpy as np

DIM = 2**14
_NGRAMS = (3, 4, 5)
_WS = re.compile(r"\s+")


def _normalize(text: str) -> str:
    return _WS.sub(" ", re.sub(r"[^a-z0-9$%. ]", " ", text.lower())).strip()


def hashed_vector(text: str) -> np.ndarray:
    vec = np.zeros(DIM, dtype=np.float32)
    padded = f" {_normalize(text)} "
    for n in _NGRAMS:
        for i in range(len(padded) - n + 1):
            vec[zlib.crc32(padded[i : i + n].encode()) % DIM] += 1.0
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm else vec


def hashed_matrix(texts: list[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, DIM), dtype=np.float32)
    return np.stack([hashed_vector(t) for t in texts])


def nearest_neighbour_sims(matrix: np.ndarray) -> np.ndarray:
    """For each row, the cosine similarity to its most similar *other* row."""
    if len(matrix) < 2:
        return np.zeros(len(matrix), dtype=np.float32)
    sims = matrix @ matrix.T
    np.fill_diagonal(sims, -1.0)
    return sims.max(axis=1)
