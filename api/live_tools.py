"""Planboard tools Gemini Live can call. Hits Express (/api/plans, /api/compare)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from api.config import get_settings

log = logging.getLogger(__name__)

FUNCTION_DECLARATIONS: list[dict[str, Any]] = [
    {
        "name": "create_plan",
        "description": "Build a shopping checklist from what the user wants to get ready for, then fetch store offers.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "prompt": {"type": "STRING", "description": "What they are preparing for, in their words"},
                "category": {
                    "type": "STRING",
                    "description": "groceries, wedding, camping, electronics, or custom",
                },
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "get_plan",
        "description": "Read the current checklist, prices, and quote.",
        "parameters": {"type": "OBJECT", "properties": {"plan_id": {"type": "STRING"}}},
    },
    {
        "name": "mark_purchased",
        "description": "Check or uncheck an item as already bought.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "item_id": {"type": "STRING", "description": "Checklist item id from get_plan or create_plan"},
                "purchased": {"type": "BOOLEAN"},
            },
            "required": ["item_id", "purchased"],
        },
    },
    {
        "name": "compare_listings",
        "description": "Compare two store listings for one checklist item using bang-per-buck, relevancy, and trust.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "item_id": {"type": "STRING"},
                "left_product_id": {"type": "STRING"},
                "right_product_id": {"type": "STRING"},
            },
            "required": ["item_id", "left_product_id", "right_product_id"],
        },
    },
    {
        "name": "set_trust_floor",
        "description": "Set the trust floor (0 to 1, default 0.5). Does not refetch listings.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "trust_floor": {"type": "NUMBER", "description": "Lower bound on the trust multiplier, typically 0.5"},
            },
            "required": ["trust_floor"],
        },
    },
    {
        "name": "list_shortlist",
        "description": "Name the top store listings for one checklist item so the user can pick two to compare.",
        "parameters": {
            "type": "OBJECT",
            "properties": {"item_id": {"type": "STRING"}},
            "required": ["item_id"],
        },
    },
]


class LiveContext:
    def __init__(self) -> None:
        self.plan_id: str | None = None
        self.trust_floor: float = 0.5
        self.plan: dict[str, Any] | None = None

    async def execute(self, function_name: str, args: dict[str, Any]) -> dict[str, Any]:
        log.info("live tool %s", function_name)
        args = args or {}
        if function_name == "create_plan":
            return await self._create_plan(args)
        if function_name == "get_plan":
            return await self._get_plan(args.get("plan_id") or self.plan_id)
        if function_name == "mark_purchased":
            return await self._mark_purchased(args)
        if function_name == "compare_listings":
            return await self._compare(args)
        if function_name == "set_trust_floor":
            return self._set_trust_floor(args)
        if function_name == "list_shortlist":
            return self._shortlist(args.get("item_id"))
        return {"error": f"Unknown function {function_name}"}

    async def _create_plan(self, args: dict[str, Any]) -> dict[str, Any]:
        prompt = str(args.get("prompt") or "").strip()
        if not prompt:
            return {"error": "prompt is required"}
        body = await self._http("POST", "/api/plans", {
            "prompt": prompt,
            "category": str(args.get("category") or ""),
        })
        if "error" in body and "id" not in body:
            return body
        self.plan = body
        self.plan_id = body.get("id")
        return {"status": "success", "ui": "PLAN", "plan": _brief_plan(body)}

    async def _get_plan(self, plan_id: str | None) -> dict[str, Any]:
        if not plan_id:
            return {"error": "no plan yet; ask what they are getting ready for"}
        body = await self._http("GET", f"/api/plans/{plan_id}")
        if "id" in body:
            self.plan = body
            self.plan_id = body["id"]
        return {"status": "success", "ui": "PLAN", "plan": _brief_plan(body)}

    async def _mark_purchased(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.plan_id:
            return {"error": "no plan yet"}
        body = await self._http(
            "PATCH",
            f"/api/plans/{self.plan_id}/items/{args.get('item_id')}",
            {"purchased": bool(args.get("purchased"))},
        )
        if "id" in body:
            self.plan = body
        return {"status": "success", "ui": "PLAN", "plan": _brief_plan(body)}

    async def _compare(self, args: dict[str, Any]) -> dict[str, Any]:
        plan = self.plan
        if not plan:
            got = await self._get_plan(self.plan_id)
            if "error" in got:
                return got
            plan = self.plan
        item = _find_item(plan, args.get("item_id"))
        if not item:
            return {"error": "item not on the current plan"}
        left = _find_product(item, args.get("left_product_id"))
        right = _find_product(item, args.get("right_product_id"))
        if not left or not right:
            return {"error": "need two listings from that item's shortlist"}
        body = await self._http("POST", "/api/compare", {
            "left": _valued(left),
            "right": _valued(right),
            "trust_floor": self.trust_floor,
        })
        if body.get("error"):
            return body
        return {
            "status": "success",
            "ui": "COMPARE",
            "item_id": item["id"],
            "compare": {
                "pick": body.get("pick"),
                "split_decision": body.get("split_decision"),
                "reasons": body.get("reasons") or [],
                "trust_floor": body.get("trust_floor", self.trust_floor),
                "left": _listing_peek(body.get("left") or left),
                "right": _listing_peek(body.get("right") or right),
                "axes": body.get("axes") or [],
            },
        }

    def _set_trust_floor(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            value = float(args.get("trust_floor"))
        except (TypeError, ValueError):
            return {"error": "trust_floor must be a number"}
        self.trust_floor = min(1.0, max(0.0, value))
        return {"status": "success", "ui": "TRUST_FLOOR", "trust_floor": self.trust_floor}

    def _shortlist(self, item_id: str | None) -> dict[str, Any]:
        item = _find_item(self.plan, item_id)
        if not item:
            return {"error": "item not on the current plan"}
        listings = []
        for product in (item.get("products") or [])[:10]:
            listings.append(_listing_peek(product))
        return {"status": "success", "ui": "SHORTLIST", "item_id": item["id"], "listings": listings}

    async def _http(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        settings = get_settings()
        try:
            async with httpx.AsyncClient(base_url=settings.planboard_url, timeout=90.0) as client:
                response = await client.request(method, path, json=payload)
        except httpx.HTTPError as exc:
            log.warning("planboard %s %s failed: %s", method, path, exc)
            return {"error": f"planboard unreachable ({exc})"}
        try:
            body = response.json()
        except ValueError:
            return {"error": f"planboard returned {response.status_code}"}
        if response.status_code >= 400:
            return {"error": body.get("error") or f"planboard {response.status_code}"}
        return body


def _brief_plan(plan: dict[str, Any] | None) -> dict[str, Any]:
    if not plan or "id" not in plan:
        return plan or {}
    items = []
    for item in plan.get("items") or []:
        best = (item.get("synthesis") or {}).get("best") or {}
        items.append({
            "id": item.get("id"),
            "name": item.get("name"),
            "quantity": item.get("quantity"),
            "unit": item.get("unit"),
            "reason": item.get("reason"),
            "purchased": item.get("purchased"),
            "best": _listing_peek(best) if best else None,
            "listing_count": len(item.get("products") or []),
        })
    return {
        "id": plan.get("id"),
        "title": plan.get("title"),
        "prompt": plan.get("prompt"),
        "category": plan.get("category"),
        "quote": plan.get("quote"),
        "items": items,
    }


def _find_item(plan: dict[str, Any] | None, item_id: str | None) -> dict[str, Any] | None:
    if not plan or not item_id:
        return None
    for item in plan.get("items") or []:
        if item.get("id") == item_id or str(item.get("name") or "").lower() == str(item_id).lower():
            return item
    return None


def _find_product(item: dict[str, Any], product_id: str | None) -> dict[str, Any] | None:
    if not product_id:
        return None
    for product in item.get("products") or []:
        if product.get("id") == product_id:
            return product
    best = (item.get("synthesis") or {}).get("best")
    if best and best.get("id") == product_id:
        return best
    return None


def _listing_peek(product: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": product.get("id"),
        "title": product.get("title"),
        "store": product.get("store"),
        "price": product.get("price"),
        "currency": product.get("currency") or "USD",
        "score": product.get("score"),
        "bang_per_buck": product.get("bang_per_buck"),
        "relevancy": product.get("relevancy"),
        "trust": product.get("trust"),
    }


def _valued(product: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": product.get("id") or "",
        "title": product.get("title") or "",
        "store": product.get("store") or "",
        "url": product.get("url"),
        "price": product.get("price"),
        "in_stock": product.get("in_stock", product.get("inStock", True)),
        "bang_per_buck": product.get("bang_per_buck", 0.5),
        "relevancy": product.get("relevancy", 1),
        "trust": product.get("trust", 0.5),
        "flags": product.get("flags") or [],
        "brand": product.get("brand"),
        "specs": product.get("specs") or {},
        "marketplace": product.get("marketplace"),
        "history": product.get("history"),
        "condition": product.get("condition") or "new",
        "rating": product.get("rating"),
        "review_count": product.get("review_count") or product.get("reviewCount") or 0,
        "prime": product.get("prime") or False,
        "shipping_days": product.get("shipping_days") or product.get("shippingDays"),
        "image": product.get("image"),
        "currency": product.get("currency") or "USD",
    }
