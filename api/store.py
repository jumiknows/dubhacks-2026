"""Read-only, in-memory catalog: products, trust reports, merchants."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from api.config import DATA_DIR, get_settings
from api.schemas import Merchant, Product, TrustReport

log = logging.getLogger(__name__)


@dataclass
class Store:
    products: dict[str, Product] = field(default_factory=dict)
    trust: dict[str, TrustReport] = field(default_factory=dict)
    merchants: dict[str, Merchant] = field(default_factory=dict)

    def product(self, product_id: str) -> Product | None:
        return self.products.get(product_id)

    def trust_report(self, product_id: str) -> TrustReport | None:
        return self.trust.get(product_id)

    def merchant_verified(self, merchant_id: str) -> bool:
        m = self.merchants.get(merchant_id)
        return bool(m and m.verified)


def _ensure_data(data_dir: Path) -> None:
    needed = ["catalog.json", "trust_reports.json", "merchants.json"]
    if all((data_dir / n).exists() for n in needed):
        return
    log.warning("Data files missing in %s; generating mock data.", data_dir)
    from api.trust.make_mock import generate

    generate(data_dir)


def load(data_dir: Path = DATA_DIR) -> Store:
    _ensure_data(data_dir)
    base = get_settings().public_base_url.rstrip("/")
    products: dict[str, Product] = {}
    for raw in json.loads((data_dir / "catalog.json").read_text()):
        p = Product.model_validate(raw)
        if p.image.startswith("/"):
            p.image = base + p.image
        products[p.id] = p
    trust = {
        r.product_id: r
        for r in (TrustReport.model_validate(x) for x in json.loads((data_dir / "trust_reports.json").read_text()))
    }
    merchants = {
        m.id: m for m in (Merchant.model_validate(x) for x in json.loads((data_dir / "merchants.json").read_text()))
    }
    return Store(products=products, trust=trust, merchants=merchants)


store: Store = Store()


def init(data_dir: Path = DATA_DIR) -> Store:
    """Load data into the module-level store. Called once at startup."""
    global store
    loaded = load(data_dir)
    store.products, store.trust, store.merchants = loaded.products, loaded.trust, loaded.merchants
    return store
