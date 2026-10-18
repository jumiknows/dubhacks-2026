# Pitch

**Planboard** turns one sentence (“get ready for camping”) into a buy list, then helps you pick *which* listing to actually pay for — without reading three product pages and a price-history site by hand.

## The problem judges already know

Search ranks by sponsored placement and sticker price. The cheap tent is often used, slow to ship, or $12 *above* what it sold for last month. The “4.8 stars” listing is often a review burst. People spend the evening opening Amazon, eBay, Walmart, CamelCamelCamel, and CamelMart in separate tabs. That is the waste: duplicated attention, not missing SKUs.

## What we built

1. **Prompt → tree of things to buy**, not a widget picker. Camping is a group; a tent is a node you zoom into; a sku is something you can purchase.
2. **One query from the app fans out** to Amazon, eBay, and Walmart (Python + Selenium when live, fixtures when not). The Node planner does not scrape.
3. **Search ranking** is a small weighted model so the reel is not random.
4. **Item vs item** is a different, simpler model judges can audit on the slide:

```
score = (bang per buck × relevancy) × trust multiplier
```

Relevancy is the next slice (spec match to the prompt). Until it ships it is `1.0`, so we are not ranking on a fake number.

Trust is a **multiplier with a floor** (default 0.5, the user can drag it). Untrusted listings get cheaper, they do not vanish unless the user wants that. Changing the floor does **not** refetch pages or history.

Price history (CamelCamelCamel for Amazon, CamelMart for Walmart) answers “is this actually a deal?” instead of “is this cheaper than the other tab?”

Hands: pinch to swipe, fist to select, so the compare sheet is usable without hunting tiny checkboxes.

## Why this model is efficient (for the user and for us)

| Instead of… | We… |
|---|---|
| Additive soup of 7+ weights the user cannot feel | Three named terms: utility, fit, trust |
| “Sort by price” | Bang per **landed** dollar, vs **this SKU’s** 90-day mean |
| Re-scraping when the user tightens trust | Multiply again in memory |
| One opaque “best” | Per-axis table (specs, shipping, reviews) plus an optional pick |
| Opening Camel and CamelMart yourself | One extra cached fetch per ASIN / Walmart id |
| Parallel Selenium chaos | One locked browser, product page first, history second, timeout cannot block the list |

Compute stays tiny: a handful of 0–1 features and one product. The expensive part is I/O, so we cache by id and never block the checklist on history.

## What to demo in two minutes

1. Type the camping prompt → list appears (red = still to buy).
2. Open two tents → scorecard: bang/buck, trust multiplier, 90-day average.
3. Drag **trust floor** from 0.5 toward 0.2: the thin-review listing collapses; the Prime one holds. Drag toward 0.9: price leads again.
4. Fist-confirm the winner. The node goes green when it is purchased.

If live scrape is blocked, fixtures still run the same formula. Say that out loud; judges care that the model is real even when the web is hostile.

## What we are not claiming

- We are not a new marketplace.
- Relevancy is **not implemented yet**; the pitch should say “bang per buck × trust today; relevancy next.”
- Selenium is a hackathon fetch, not a productized crawler. APIs replace it.

## The line to leave them with

We do not add more results. We spend fewer tabs to decide between the ones you already have — utility first, trust as a multiplier you can turn, history so “cheap” means cheap *for this item*.
