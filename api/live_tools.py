"""Planner tools the assistants can call: Gemini Live (voice) and /planner/chat (typed).

Every tool goes through Express (/api/plans, /api/compare), so the assistant sees the same
plan the screen shows. Tools can build, inspect, compare, pick and stage items in the cart.
None of them can pay: start_checkout only opens the review sheet, and the user places the order.
"""

from __future__ import annotations

import logging
import math
import re
from typing import Any

import httpx

from api.config import get_settings

log = logging.getLogger(__name__)

_ITEM_ID = {"type": "STRING", "description": "Item id from get_plan, or the item's name"}

FUNCTION_DECLARATIONS: list[dict[str, Any]] = [
    {
        "name": "create_plan",
        "description": "Build a shopping list from what the user wants to get ready for, then fetch store offers.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "prompt": {"type": "STRING", "description": "What they are preparing for, in their words"},
                "category": {
                    "type": "STRING",
                    "description": "travel, camping, groceries, wedding, electronics, or custom",
                },
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "get_plan",
        "description": "Read the current list: items, their best offers, what is bought, and the total.",
        "parameters": {"type": "OBJECT", "properties": {"plan_id": {"type": "STRING"}}},
    },
    {
        "name": "open_item",
        "description": "Show one item's store listings full screen so the user can look at them.",
        "parameters": {"type": "OBJECT", "properties": {"item_id": _ITEM_ID}, "required": ["item_id"]},
    },
    {
        "name": "list_shortlist",
        "description": "Name the top store listings for one item so the user can pick two to compare.",
        "parameters": {"type": "OBJECT", "properties": {"item_id": _ITEM_ID}, "required": ["item_id"]},
    },
    {
        "name": "compare_listings",
        "description": ("Compare two store listings for one item on bang-per-buck, relevancy and trust. "
                        "Leave the listing ids out to compare the two best-ranked listings."),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "item_id": _ITEM_ID,
                "left_product_id": {"type": "STRING", "description": "Listing id, store name, or title words"},
                "right_product_id": {"type": "STRING", "description": "Listing id, store name, or title words"},
            },
            "required": ["item_id"],
        },
    },
    {
        "name": "pick_listing",
        "description": "Make one listing the chosen offer for an item (for example the comparison winner).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "item_id": _ITEM_ID,
                "product_id": {"type": "STRING", "description": "Listing id, store name, or title words"},
            },
            "required": ["item_id", "product_id"],
        },
    },
    {
        "name": "add_to_cart",
        "description": "Put an item's chosen offer in the cart (yellow). Does not pay.",
        "parameters": {"type": "OBJECT", "properties": {"item_id": _ITEM_ID}, "required": ["item_id"]},
    },
    {
        "name": "mark_purchased",
        "description": "Check or uncheck an item as already bought.",
        "parameters": {
            "type": "OBJECT",
            "properties": {"item_id": _ITEM_ID, "purchased": {"type": "BOOLEAN"}},
            "required": ["item_id", "purchased"],
        },
    },
    {
        "name": "set_trust_floor",
        "description": "Set the trust floor (0 to 1, default 0.5). Higher lets well-reviewed listings win. Does not refetch.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "trust_floor": {"type": "NUMBER", "description": "Lower bound on the trust multiplier, typically 0.5"},
            },
            "required": ["trust_floor"],
        },
    },
    {
        "name": "start_checkout",
        "description": ("Open the checkout review sheet for what is in the cart. The user reviews and places "
                        "the order themselves; you cannot pay or confirm it."),
        "parameters": {"type": "OBJECT", "properties": {}},
    },
]


def openai_tools() -> list[dict[str, Any]]:
    """The same declarations in OpenAI-compatible Chat Completions form."""

    def schema(node: Any) -> Any:
        if isinstance(node, dict):
            return {k: (v.lower() if k == "type" and isinstance(v, str) else schema(v)) for k, v in node.items()}
        if isinstance(node, list):
            return [schema(v) for v in node]
        return node

    return [{"type": "function", "function": {"name": d["name"], "description": d["description"],
                                              "parameters": schema(d["parameters"])}}
            for d in FUNCTION_DECLARATIONS]


class LiveContext:
    def __init__(self, session_cookie: str | None = None) -> None:
        self.plan_id: str | None = None
        self.trust_floor: float = 0.5
        self.plan: dict[str, Any] | None = None
        self.last_compare: dict[str, Any] | None = None
        self.session_cookie = session_cookie if session_cookie and re.fullmatch(r"[A-Za-z0-9_-]+", session_cookie) else None

    async def execute(self, function_name: str, args: dict[str, Any]) -> dict[str, Any]:
        log.info("planner tool %s", function_name)
        if not isinstance(args, dict):
            return {"error": "Tool arguments must be an object"}
        try:
            if function_name == "create_plan":
                return await self._create_plan(args)
            if function_name == "get_plan":
                return await self._get_plan(args.get("plan_id") or self.plan_id)
            if function_name == "open_item":
                return await self._open_item(args)
            if function_name == "list_shortlist":
                return await self._shortlist(args.get("item_id"))
            if function_name == "compare_listings":
                return await self._compare(args)
            if function_name == "pick_listing":
                return await self._pick(args)
            if function_name == "add_to_cart":
                return await self._add_to_cart(args)
            if function_name == "mark_purchased":
                return await self._mark_purchased(args)
            if function_name == "set_trust_floor":
                return self._set_trust_floor(args)
            if function_name == "start_checkout":
                return {"status": "success", "ui": "CHECKOUT",
                        "note": "The review sheet is open. The user must place the order themselves."}
        except (TypeError, ValueError) as exc:
            return {"error": f"bad arguments for {function_name}: {exc}"}
        return {"error": f"Unknown function {function_name}"}

    async def load(self) -> dict[str, Any] | None:
        """Make sure self.plan is current; returns None when there is no plan."""
        if self.plan_id:
            body = await self._http("GET", f"/api/plans/{self.plan_id}")
            self.plan = body if "id" in body else None
        return self.plan

    async def _create_plan(self, args: dict[str, Any]) -> dict[str, Any]:
        prompt = str(args.get("prompt") or "").strip()[:2000]
        if not prompt:
            return {"error": "prompt is required"}
        category = str(args.get("category") or "").strip().lower()
        body: dict[str, Any] = {"prompt": prompt, "async": True}
        if category in {"travel", "groceries", "wedding", "camping", "electronics", "custom"}:
            body["category"] = category
        plan = await self._http("POST", "/api/plans", body)
        if "id" not in plan:
            return plan
        self.plan, self.plan_id = plan, plan["id"]
        return {"status": "success", "ui": "PLAN", "plan": _brief_plan(plan)}

    async def _get_plan(self, plan_id: str | None) -> dict[str, Any]:
        if not plan_id:
            return {"error": "no plan yet; ask what they are getting ready for"}
        body = await self._http("GET", f"/api/plans/{plan_id}")
        if "id" not in body:
            return body if body.get("error") else {"error": "that plan is gone; build a new one"}
        self.plan_id, self.plan = plan_id, body
        plan = body
        return {"status": "success", "ui": "PLAN", "plan": _brief_plan(plan)}

    async def _item(self, item_ref: Any) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        plan = await self.load()
        if not plan:
            return None, {"error": "no plan yet; ask what they are getting ready for"}
        item = find_item(plan, item_ref)
        if not item:
            names = ", ".join(str(i.get("name")) for i in plan.get("items") or [])
            return None, {"error": f"no item like that on the list. Items: {names}"}
        return item, None

    async def _open_item(self, args: dict[str, Any]) -> dict[str, Any]:
        item, error = await self._item(args.get("item_id"))
        if error:
            return error
        return {"status": "success", "ui": "FOCUS", "item_id": item["id"], "item": item.get("name"),
                "listings": [listing_peek(p) for p in (item.get("products") or [])[:5]]}

    async def _shortlist(self, item_ref: Any) -> dict[str, Any]:
        item, error = await self._item(item_ref)
        if error:
            return error
        listings = [listing_peek(p) for p in (item.get("products") or [])[:10]]
        return {"status": "success", "ui": "SHORTLIST", "item_id": item["id"], "listings": listings}

    async def _compare(self, args: dict[str, Any]) -> dict[str, Any]:
        item, error = await self._item(args.get("item_id"))
        if error:
            return error
        products = item.get("products") or []
        left = find_product(item, args.get("left_product_id")) if args.get("left_product_id") else None
        right = find_product(item, args.get("right_product_id")) if args.get("right_product_id") else None
        ranked = [p for p in products if p not in (left, right)]
        left = left or (ranked.pop(0) if ranked else None)
        right = right or (ranked.pop(0) if ranked else None)
        if not left or not right or left.get("id") == right.get("id"):
            return {"error": "that item needs two different listings to compare"}
        body = await self._http("POST", "/api/compare", {
            "left": valued(left),
            "right": valued(right),
            "trust_floor": self.trust_floor,
        })
        if body.get("error"):
            return body
        winner = {"left": left, "right": right}.get(body.get("pick") or "")
        self.last_compare = {"item_id": item["id"], "left_id": left.get("id"), "right_id": right.get("id"),
                             "winner_id": winner.get("id") if winner else None}
        return {
            "status": "success",
            "ui": "COMPARE",
            "item_id": item["id"],
            "compare": {
                "pick": body.get("pick"),
                "split_decision": body.get("split_decision"),
                "reasons": body.get("reasons") or [],
                "trust_floor": body.get("trust_floor", self.trust_floor),
                "left": {**listing_peek(left), **_scores(body.get("left"))},
                "right": {**listing_peek(right), **_scores(body.get("right"))},
                "axes": body.get("axes") or [],
            },
        }

    async def _pick(self, args: dict[str, Any]) -> dict[str, Any]:
        item, error = await self._item(args.get("item_id"))
        if error:
            return error
        product = find_product(item, args.get("product_id"))
        if not product:
            return {"error": "that listing is not one of this item's options"}
        plan = await self._http("PUT", f"/api/plans/{self.plan_id}/items/{item['id']}/listing",
                                {"listingId": product["id"]})
        if "id" not in plan:
            return plan
        self.plan = plan
        return {"status": "success", "ui": "PLAN", "plan": _brief_plan(plan), "item_id": item["id"],
                "picked": listing_peek(product)}

    async def _add_to_cart(self, args: dict[str, Any]) -> dict[str, Any]:
        item, error = await self._item(args.get("item_id"))
        if error:
            return error
        if item.get("purchased") or item.get("owned"):
            return {"error": f"{item.get('name')} is already bought"}
        total = (item.get("synthesis") or {}).get("totalPrice")
        if not _finite(total) or total <= 0:
            return {"error": f"{item.get('name')} has no priced listing to buy yet"}
        best = (item.get("synthesis") or {}).get("best") or {}
        if best.get("inStock", best.get("in_stock")) is not True or not best.get("currency") or not _finite(best.get("price")) or best["price"] <= 0:
            return {"error": "the chosen offer needs a confirmed price, currency and stock before adding to cart"}
        return {"status": "success", "ui": "CART", "item_id": item["id"], "item": item.get("name"),
                "offer": listing_peek(best), "total": total}

    async def _mark_purchased(self, args: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(args.get("purchased"), bool):
            return {"error": "purchased must be a boolean"}
        item, error = await self._item(args.get("item_id"))
        if error:
            return error
        plan = await self._http("PATCH", f"/api/plans/{self.plan_id}/items/{item['id']}",
                                {"purchased": args["purchased"]})
        if "id" not in plan:
            return plan
        self.plan = plan
        return {"status": "success", "ui": "PLAN", "plan": _brief_plan(plan)}

    def _set_trust_floor(self, args: dict[str, Any]) -> dict[str, Any]:
        if isinstance(args.get("trust_floor"), bool):
            return {"error": "trust_floor must be a finite number"}
        value = float(args.get("trust_floor"))
        if not math.isfinite(value):
            return {"error": "trust_floor must be a finite number"}
        if value > 1:
            value /= 100  # "trust floor 80" means 80%
        self.trust_floor = min(1.0, max(0.0, value))
        return {"status": "success", "ui": "TRUST_FLOOR", "trust_floor": self.trust_floor}

    async def _http(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        settings = get_settings()
        try:
            async with httpx.AsyncClient(base_url=settings.planboard_url, timeout=90.0) as client:
                if self.session_cookie:
                    client.cookies.set("pb_sid", self.session_cookie)
                response = await client.request(method, path, json=payload)
                token = response.cookies.get("pb_sid")
                if token and re.fullmatch(r"[A-Za-z0-9_-]+", token):
                    self.session_cookie = token
        except httpx.HTTPError as exc:
            log.warning("planboard %s %s failed: %s", method, path, type(exc).__name__)
            return {"error": "the planner service is unreachable"}
        try:
            body = response.json()
        except ValueError:
            return {"error": f"planner returned {response.status_code}"}
        if response.status_code >= 400:
            return {"error": body.get("error") if isinstance(body, dict) else f"planner {response.status_code}"}
        return body if isinstance(body, dict) else {"error": "planner returned an unexpected shape"}


def ui_event(tool_result: dict[str, Any]) -> dict[str, Any] | None:
    """The UI_UPDATE the browser applies right away, while the assistant is still talking."""
    kind = tool_result.get("ui")
    item_id = tool_result.get("item_id")
    if kind == "PLAN" and tool_result.get("plan"):
        return {"type": "UI_UPDATE", "action": "PLAN", "payload": tool_result["plan"], "item_id": item_id}
    if kind == "COMPARE" and tool_result.get("compare"):
        return {"type": "UI_UPDATE", "action": "COMPARE", "payload": tool_result["compare"], "item_id": item_id}
    if kind == "TRUST_FLOOR":
        return {"type": "UI_UPDATE", "action": "TRUST_FLOOR", "payload": {"trust_floor": tool_result.get("trust_floor")}}
    if kind == "SHORTLIST":
        return {"type": "UI_UPDATE", "action": "SHORTLIST", "payload": tool_result.get("listings") or [], "item_id": item_id}
    if kind in ("FOCUS", "CART"):
        return {"type": "UI_UPDATE", "action": kind, "payload": {}, "item_id": item_id}
    if kind == "CHECKOUT":
        return {"type": "UI_UPDATE", "action": "CHECKOUT", "payload": {}}
    return None


def _words(text: Any) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", str(text or "").lower()) if len(w) > 1]


def find_item(plan: dict[str, Any] | None, item_ref: Any) -> dict[str, Any] | None:
    """By id, exact name, or the item whose name shares the most words with the reference."""
    if not plan or not item_ref:
        return None
    ref = str(item_ref).strip().lower()
    items = plan.get("items") or []
    for item in items:
        if item.get("id") == item_ref or str(item.get("name") or "").lower() == ref:
            return item
    wanted = set(_words(ref))
    best, overlap = None, 0
    for item in items:
        name = set(_words(item.get("name")))
        hits = len(wanted & name) + sum(1 for w in wanted for n in name if w != n and (w.startswith(n) or n.startswith(w)))
        if hits > overlap:
            best, overlap = item, hits
    return best


def find_product(item: dict[str, Any], product_ref: Any) -> dict[str, Any] | None:
    """By listing id, store name, or title words. Only the item's own listings qualify."""
    if not product_ref:
        return None
    ref = str(product_ref).strip().lower()
    products = list(item.get("products") or [])
    best = (item.get("synthesis") or {}).get("best")
    if best and all(p.get("id") != best.get("id") for p in products):
        products.append(best)
    for product in products:
        if product.get("id") == product_ref or str(product.get("store") or "").lower() == ref:
            return product
    wanted = set(_words(ref))
    scored = [(len(wanted & set(_words(f"{p.get('store')} {p.get('title')} {p.get('brand')}"))), p) for p in products]
    scored = [row for row in scored if row[0] > 0]
    return max(scored, key=lambda row: row[0])[1] if scored else None


def _brief_plan(plan: dict[str, Any] | None) -> dict[str, Any]:
    if not plan or "id" not in plan:
        return plan or {}
    items = []
    for item in plan.get("items") or []:
        synthesis = item.get("synthesis") or {}
        best = synthesis.get("best") or {}
        items.append({
            "id": item.get("id"),
            "name": item.get("name"),
            "quantity": item.get("quantity"),
            "unit": item.get("unit"),
            "reason": item.get("reason"),
            "purchased": item.get("purchased"),
            "owned": item.get("owned"),
            "total": synthesis.get("totalPrice"),
            "best": listing_peek(best) if best else None,
            "listing_count": len(item.get("products") or []),
        })
    brief = {
        "id": plan.get("id"),
        "title": plan.get("title"),
        "prompt": plan.get("prompt"),
        "category": plan.get("category"),
        "status": plan.get("status") or "ready",
        "quote": plan.get("quote"),
        "items": items,
    }

    if brief["status"] == "pricing":
        priced = sum(1 for item in items if item["best"])
        brief["note"] = f"Prices are still loading on screen ({priced} of {len(items)} items priced)."
    return brief


def listing_peek(product: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": product.get("id"),
        "title": product.get("title"),
        "store": product.get("store"),
        "price": product.get("price"),
        "currency": product.get("currency"),
        "source": product.get("source"),
        "isMock": product.get("isMock"),
        "warnings": product.get("warnings") or [],
        "score": product.get("score"),
        "bang_per_buck": product.get("bang_per_buck"),
        "relevancy": product.get("relevancy"),
        "trust": product.get("trust"),
        "rating": product.get("rating"),
        "in_stock": product.get("inStock", product.get("in_stock")),
    }


def _scores(row: Any) -> dict[str, Any]:
    if not isinstance(row, dict):
        return {}
    return {k: row[k] for k in ("score", "initial_value", "trust_multiplier") if k in row}


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _num(value: Any, default: float) -> float:
    return float(value) if _finite(value) else default


def valued(product: dict[str, Any]) -> dict[str, Any]:
    """Shape a sanitized listing for /market/compare. Unknown signals get neutral defaults, never None."""
    dims = product.get("dimensions")
    return {
        "id": str(product.get("id") or ""),
        "title": str(product.get("title") or ""),
        "store": str(product.get("store") or ""),
        "url": product.get("url"),
        "price": product.get("price") if _finite(product.get("price")) else None,
        "in_stock": product.get("inStock", product.get("in_stock")) is True,
        "bang_per_buck": max(0.0, _num(product.get("bang_per_buck"), 0.5)),
        "relevancy": max(0.0, _num(product.get("relevancy"), 1.0)),
        "trust": min(1.0, max(0.0, _num(product.get("trust"), 0.5))),
        "flags": [f for f in product.get("flags") or [] if isinstance(f, str)],
        "brand": product.get("brand"),
        "specs": {str(k): str(v) for k, v in (product.get("specs") or {}).items() if v is not None},
        "marketplace": product.get("marketplace"),
        "history": product.get("history") if isinstance(product.get("history"), dict) else None,
        "condition": str(product.get("condition") or "new"),
        "rating": product.get("rating") if isinstance(product.get("rating"), (int, float)) else None,
        "review_count": int(_num(product.get("review_count") or product.get("reviewCount"), 0)),
        "prime": product.get("prime") is True,
        "shipping_days": product.get("shipping_days") or product.get("shippingDays"),
        "image": product.get("image"),
        "currency": product.get("currency") or "UNKNOWN",
        "dimensions": dims if isinstance(dims, dict) else None,
    }
