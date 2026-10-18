from __future__ import annotations

import json
import re
from typing import Any

from bs4 import BeautifulSoup

PRICE_RE = re.compile(r"(\d[\d,]*(?:\.\d{1,2})?)")
RATING_RE = re.compile(r"(\d(?:\.\d)?)\s*out of\s*5", re.I)
REVIEWS_RE = re.compile(r"([\d,]+)\s+ratings?", re.I)
DAYS_RE = re.compile(r"(?:in|within)\s+(\d+)\s+day", re.I)


def soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")


def json_ld(html: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for tag in soup(html).select("script[type='application/ld+json']"):
        raw = (tag.string or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            found.extend(item for item in data if isinstance(item, dict))
        elif isinstance(data, dict):
            graph = data.get("@graph")
            if isinstance(graph, list):
                found.extend(item for item in graph if isinstance(item, dict))
            else:
                found.append(data)
    return found


def product_ld(html: str) -> dict[str, Any] | None:
    for item in json_ld(html):
        types = item.get("@type")
        names = types if isinstance(types, list) else [types]
        if any(name in {"Product", "http://schema.org/Product"} for name in names):
            return item
    return None


def parse_price(text: str | None) -> float | None:
    if not text:
        return None
    match = PRICE_RE.search(str(text).replace("\xa0", " "))
    if not match:
        return None
    try:
        return round(float(match.group(1).replace(",", "")), 2)
    except ValueError:
        return None


def parse_int(text: str | None) -> int | None:
    if text is None:
        return None
    digits = re.sub(r"[^\d]", "", str(text))
    if not digits:
        return None
    try:
        return int(digits)
    except ValueError:
        return None


def first_text(doc: BeautifulSoup, selectors: list[str]) -> str | None:
    for selector in selectors:
        node = doc.select_one(selector)
        if node:
            value = node.get_text(" ", strip=True)
            if value:
                return value
    return None


def first_attr(doc: BeautifulSoup, selectors: list[str], attr: str) -> str | None:
    for selector in selectors:
        node = doc.select_one(selector)
        if node and node.get(attr):
            return str(node.get(attr))
    return None


def shipping_days(text: str | None) -> int | None:
    if not text:
        return None
    lower = text.lower()
    if "tomorrow" in lower or "today" in lower or "same-day" in lower:
        return 1
    if "two-day" in lower or "2-day" in lower or "prime" in lower:
        return 2
    match = DAYS_RE.search(lower)
    if match:
        return int(match.group(1))
    return None


def rating_from_text(text: str | None) -> float | None:
    if not text:
        return None
    match = RATING_RE.search(text)
    if match:
        return float(match.group(1))
    try:
        value = float(text.strip().split()[0])
        if 0 < value <= 5:
            return value
    except (ValueError, IndexError):
        return None
    return None


def reviews_from_text(text: str | None) -> int:
    if not text:
        return 0
    match = REVIEWS_RE.search(text) or re.search(r"([\d,]+)", text)
    if not match:
        return 0
    return parse_int(match.group(1)) or 0
