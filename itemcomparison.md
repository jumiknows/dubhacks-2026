# Item comparison

Today `POST /market/synthesize` ranks a *cohort* of listings for one plan item (cheapest-trusted wins). That is not enough once the user opens two specific products. This file is the plan to compare **item A vs item B** using the whole product page, plus Amazon/Walmart price history from CamelCamelCamel and CamelMart.

The Express planner still sends queries. Python pulls a **wide recall set** (about **50 most relevant hits per marketplace**), scores relevancy, then either ranks a top list or compares two resolved listings. CamelCamelCamel and CamelMart are **not** extra stores to search. They only supply **past price-change history** (Amazon and Walmart respectively) so bang-per-buck can see whether today’s sticker is a drop, a spike, or typical.

## What “compare two items” means

A comparison is always between two (later: N) **resolved listings**, not between two search queries.

```
CompareRequest = {
  left:  { url | asin | walmart_id | product },
  right: { url | asin | walmart_id | product },
  context: {
    plan_item_name, quantity, budget, needs[], avoid[],
    trust_floor: 0.5,          // user-adjustable lower bound on the trust multiplier
    min_price, max_price,      // TODO future, applied after relevancy
    brands_include[], brands_exclude[]
  }
}
```

Headline score (what ranks A vs B):

```
initial_value     = bang_per_buck × relevancy      // relevancy is a stub until implemented
trust_multiplier  = trust_floor + (1 - trust_floor) × trust   // trust in [0, 1]
score             = initial_value × trust_multiplier
```

The scorecard still shows every axis. Do not hide a losing axis. A cheaper tent that ships in 12 days can still win `score` if relevancy is high, but Shipping in the table must say it lost.

## Recall: ~50 most relevant per site

Search is per marketplace, not a mixed page of 4 results.

```
for site in {amazon, ebay, walmart}:
  take the ~50 listings that best match the query on that site
pool = amazon_50 ∪ ebay_50 ∪ walmart_50    // up to ~150
```

“Most relevant” here is the **site’s own search ranking** (title/query match on the results page), then our **relevancy** score once we have titles, brands, and prices. Do not open 150 product pages on day one.

**Cheap path (v1):** parse the search-result card only (title, brand if shown, price, url, rating). Score relevancy on that. Keep the top ~50 per site by that score. Detail-fetch + Camel/CamelMart only for the survivors that enter `/market/top` (~10) or `/market/compare` (2).

**Full path (later):** same 50 per site, then product pages for the top slice.

`POST /market/search` should grow `limit` toward 50 per marketplace (`SCRAPE_LIMIT` is 4 today). `POST /market/top` still returns about ten **from that pool**, not ten raw search hits. Compare always picks two ids that already sat in the pool.

If a site returns fewer than 50, keep what it gave. Do not pad with unrelated SKUs.

## Relevancy filters (future)

Once relevancy is implemented, it is also the gate for **price and brand filters** the user (or the prompt) will set later. Filters run **after** the 50-per-site recall, **before** top-10 and compare. They do not replace relevancy; they cut the pool.

```
pool_50_per_site
  → relevancy score
  → filter price  (min / max / “around $X”)     // TODO future
  → filter brands (include / exclude)           // TODO future
  → top ~10  or  compare(left, right)
```

**Price (future)**
- `min_price`, `max_price` on the request
- Prompt phrases: “under $80”, “not cheap junk”, “budget”
- Optional band from the relevancy-weighted median of the 50-per-site pool (drop the bottom/top decile so a $12 toy tent does not define “camping tent”)
- Landed price when we have shipping; sticker until then

**Brands (future)**
- `brands_include[]`, `brands_exclude[]`
- Prompt: “Coleman or REI”, “not no-name”
- Brands that never appear among high-relevancy hits stay out of the include list (do not invent a brand filter from one Amazon’s Choice badge)
- Store the brand on the search card as soon as parse can see it, even before spec tables exist

Until these ship, relevancy stays `1.0` and the pool is unfiltered except in-stock for `pick`. The API should still accept empty `min_price` / `max_price` / `brands_*` so the client can send them later without a new contract.

## Page inventory (extract all of this)

Selenium already loads the product URL. Expand `parse_product` so one detail fetch fills this document. Prefer JSON-LD, then labeled tables, then visible text.

### Identity
- Canonical URL, ASIN / eBay item id / Walmart item id
- Title, brand, model, variant (color, size, capacity)
- Condition, sold-by vs ships-from
- Category / breadcrumbs (needed to pick spec keys)

### Price now
- List price, deal price, coupon, Subscribe & Save
- Shipping fee, tax estimate if shown
- Unit price (`$ / oz`, `$ / night` if we can derive it)
- Prime / Walmart+ eligibility
- Stock + “only N left”

### Past price *changes* (CamelCamelCamel / CamelMart)

These sites are **history trackers**, not catalogs. We never search them for “tents.” We look up an id we already have from Amazon or Walmart and read how the price **moved**.

| Store listing | History host | What to take |
|---|---|---|
| Amazon ASIN | **CamelCamelCamel** | Time series of Amazon / 3rd-party new / 3rd-party used prices: each change date, previous, next. Derive current, last drop, last hike, 30/90/365-day mean, all-time low/high, % vs those means. |
| Walmart item id | **CamelMart** | Same idea for Walmart: change-by-change series, then the same summaries. |
| eBay | none | Weak proxy: “N sold” and sold-comp blurbs on the listing. No Camel fetch. |

Use the **changes**, not a single “average” scraped as marketing copy:

- `near-low` — last change brought landed price within 5% of the tracked low
- `above-typical` — current is > 1.1 × 90-day mean
- `price-spike` — last change was a hike after a long stay
- `price-drop` — last change was a cut

`hist_ref` for bang-per-buck is `max(avg_90, lowest × 1.05)` from that series. Missing series → `hist_ref = landed` (today’s price only).

Fetch history **only** for listings that already passed the 50-per-site relevancy cut and are in the top list or the compare pair. Caching is by ASIN / Walmart id for the process lifetime. A timeout must not block search.

### Specifications
Parse the bullets / tech spec table into a `dict[str, str]`, then normalize a small shared set:

| Family | Keys to align across stores |
|---|---|
| Camping | packed size, peak height, capacity, season, weight, waterproof rating |
| Electronics | screen, RAM, storage, battery, ports, warranty |
| Grocery | net weight, servings, calories, allergens |
| Apparel | size, material, care |
| Generic | dimensions, weight, color, model number, UPC/EAN |

Comparison is on **aligned keys only**. A missing key is a completeness penalty, not a win for the other item.

### Reviews
Do not use the star average alone.

- Rating, count, histogram (5★…1★) if on the page
- Verified-purchase share
- Recency: median age of the last 20 reviews
- Velocity: reviews in the last 30 days vs the prior 90 (bursts)
- Aspect sentiment from the review text and “customers say” chips: leak, smell, size, battery, setup, durability
- Q&A: unanswered “does it fit X?” that matches the plan prompt is a risk flag
- Image reviews vs stock photos (count of customer images)

Store a sample of review sentences as evidence, not the full scrape, so the compare UI can quote one line per aspect.

### Media and merchandising
- Hero image + variant images
- “Amazon’s Choice” / “Best seller” badges (weak, often paid or recency-based — show, do not overweight)
- Warranty / return window text
- Bundle contents vs the plan (stakes included, charger included)

### Seller
- Name, rating, years, “usually ships within”
- FBA / WFS vs merchant-fulfilled
- Return policy length

## Comparison algorithms

Keep `synthesize.py` as the **search ranker** (seven additive weights). Pairwise compare uses a different shape: **utility first, then a trust multiplier with a floor**.

That is cheaper to explain to a judge and cheaper to compute: one product of three numbers instead of retuning seven knobs per user.

```
bang_per_buck     ∈ (0, 1]     // how much listing you get per dollar
relevancy         ∈ (0, 1]     // TODO: how well it matches the prompt / specs
initial_value     = bang_per_buck × relevancy
trust             ∈ [0, 1]     // from reviews, seller, history gaps
trust_floor       ∈ [0, 1]     // default 0.5, user-adjustable
trust_multiplier  = trust_floor + (1 - trust_floor) × trust
score             = initial_value × trust_multiplier
```

Worked example (`trust_floor = 0.5`):

| | Bang/buck | Relevancy | Initial | Trust | Multiplier | Score |
|---|---|---|---|---|---|---|
| A $79 Prime tent, 18k reviews | 0.62 | 0.90 | 0.56 | 0.88 | 0.94 | **0.53** |
| B $34 used tent, 40 reviews | 0.91 | 0.55 | 0.50 | 0.22 | 0.61 | 0.31 |

B is more “bang per sticker.” After relevancy and the floor-bounded trust multiply, A wins. If the user drags `trust_floor` to `0.9`, even junk listings keep most of their initial value (multiplier stays in `[0.9, 1]`). If they drag it to `0.2`, untrusted listings get crushed.

`trust_floor` never goes through the listing page. It is a **user preference** on the compare sheet (and later on the profile). Persist it on the session, default `0.5`.

### 1. Bang per buck

Utility over **landed** dollars, not the search-cohort median.

```
landed = price - coupon + shipping_fee + tax_est
```

When specs exist, utility is the spec the prompt cares about per dollar (person-capacity, watt-hours, servings). When they do not, utility is `1 / landed` normalized against the pair (or against Camel 90-day mean if history exists):

```
hist_ref     = max(history.avg_90, history.lowest * 1.05)   // if missing, use the other item's landed
deal         = hist_ref / landed                            // >1 means cheaper than typical
bang_per_buck = clip(deal × spec_utility, 0.05, 1.0)
```

Flags (do not change the multiply, only the table):
- `above-typical` if landed > 1.1 × 90-day mean
- `near-low` if within 5% of recorded low
- `too-cheap` if landed < 0.4 × the other item

CamelCamelCamel / CamelMart fill `hist_ref` from **past changes**. They do not add listings to the 50-per-site pool. No history → `hist_ref = landed`.

### 2. Relevancy (to be implemented)

Until this ships, **`relevancy = 1.0`** so `initial_value = bang_per_buck` and nothing silently ranks on a stub.

Target formula (do not pretend it exists in code yet):

```
relevancy = 0.45 × spec_match     // keys named in the prompt: 2-person, 16GB, …
          + 0.25 × title_tokens   // current _fit()
          + 0.15 × constraint_ok  // not used / fragrance-free / budget
          + 0.15 × bundle_fit     // stakes included, charger included
```

A 4-person tent for “camping for two” can keep high bang/buck and a mid relevancy; the UI must say that, not drop it. Negative constraints that fail (`used` when they asked new) set `constraint_ok = 0` rather than a tiny weight in an additive soup.

The same relevancy number **orders the 50-per-site pool** and, later, **feeds price/brand filters**: a brand that never scores above a floor is a candidate for `brands_exclude`; a price cluster among the top-relevancy 50 is the default band for “around what people actually buy.”

### 3. Trust → multiplier with a floor

Trust is still estimated from the page, then **mapped** into a multiplier so it cannot zero out a relevant deal unless the user wants that.

```
trust = 0.35 × (rating / 5)
      + 0.20 × log(1 + count) / log(1 + 2000)
      + 0.15 × verified_share
      + 0.15 × (1 - burst_score)
      + 0.15 × aspect_fit
```

```
trust_multiplier = trust_floor + (1 - trust_floor) × trust
```

Properties:
- `trust = 1` → multiplier `1` (no penalty)
- `trust = 0` → multiplier `trust_floor` (never below the user’s bound)
- `trust_floor = 1` → ignore trust (always 1)
- `trust_floor = 0` → full multiply (untrusted listings can go to 0)

Hard flags still show even when the multiplier is mild: 5★ pile-up, review spike, recent safety 1★s (leak, shock, mold). Flags are evidence, not extra weights.

### 4. Spec matrix (table only)

For each aligned key, coerce to a number + unit (`72 in`, `2 person`, `20 °F`).

- Higher-is-better (capacity, battery): larger wins
- Lower-is-better (weight, packed size): smaller wins
- Categorical: match `needs` / prompt; else tie
- Missing: `incomplete`, no winner — completeness penalty on relevancy later, not a fake win

This table does **not** feed the headline `score` until relevancy is implemented. It is the explainability layer.

### 5. Shipping and availability (table + soft utility)

Still parsed from the page (Prime / WFS / days). They can bump `spec_utility` (faster arrival = more useful for a trip this weekend) but they are not a second multiply. Availability is a **hard filter**: out of stock cannot be `pick`, it can only appear on the card.

### 6. Decision rule

```
pick = argmax(score)   if both in stock and |score_a - score_b| ≥ 0.05
     = null            otherwise  → split_decision
```

Always return two headlines built from the losing axes:

- Left: “Higher bang per buck after Prime shipping.”
- Right: “Closer spec match; reviews are thinner so trust pulled it down.”

If the user moves `trust_floor`, recompute `score` only (bang/buck and relevancy are unchanged). That is the efficiency: sliders do not refetch Camel or the product page.

## Data shape

Extend `MarketProduct` (keep old fields for the planner cards):

```
MarketProduct
  + asin, walmart_id, ebay_id
  + brand, model, specs: dict[str, str]
  + list_price, coupon, shipping_fee
  + reviews: { rating, count, histogram, verified_share, aspects[], quotes[] }
  + history: { source: camel|camelmart|none, current, low, high, avg_90, last_drop, series[] }
  + badges[], return_days, warranty
```

```
CompareResponse
  left / right: {
    ...product,
    bang_per_buck, relevancy, initial_value,
    trust, trust_floor, trust_multiplier, score
  }
  axes: [{ name, left, right, winner, note }]
  pick: left|right|null
  split_decision: bool
  reasons: [str]
```

## Where it goes

| Piece | File |
|---|---|
| Richer product parse (specs, reviews, ids) | `api/market/sites.py`, `api/market/parse.py` |
| CamelCamelCamel adapter | `api/market/history_camel.py` |
| CamelMart adapter | `api/market/history_camelmart.py` |
| Pairwise scorer | `api/market/compare_service.py` — two items, scores already on the payload |
| Top list | `api/market/top_service.py` — rank ~10 from the ~50×3 pool |
| Shared finish | `api/market/valued.py` — `score = bang_per_buck × relevancy × trust_multiplier` |
| HTTP | `POST /market/compare`, `POST /market/top`; Express `POST /api/compare`, `POST /api/top` |
| Node pass-through | `server/services/compareBot.js` called when the UI selects two cards |
| UI | two-up sheet: spec table, review chips, price-history sparkline, axis winners |
| Fixtures | canned Camel/CamelMart JSON so CI and `SELENIUM_ENABLED=false` still compare |

Selenium stays serialized behind the existing browser lock. Search cards first (up to 50 URLs per site). History navigations only for the shortlist: **one Camel or CamelMart page per Amazon/Walmart id**, cached for the process lifetime.

## TODOs

Open work for this issue. Rank/compare HTTP exists; value terms and UI do not.

- [ ] **50 per site** — raise search recall to ~50 most relevant listings on Amazon, eBay, and Walmart (search-card parse first, not 150 detail pages).
- [ ] **Relevancy** — implement `0.45 spec_match + 0.25 title_tokens + 0.15 constraint_ok + 0.15 bundle_fit`. Until then keep `relevancy = 1.0` (`api/market/valued.py`). Use it to order the 50-per-site pool.
- [ ] **Price filter (future)** — `min_price` / `max_price` / prompt bands, applied *after* relevancy, *before* top-10.
- [ ] **Brand filter (future)** — `brands_include[]` / `brands_exclude[]` from the prompt or UI, same pipeline slot; parse brand on the search card.
- [ ] **Bang per buck** — landed price vs **past price-change** `hist_ref` (Camel/CamelMart series, not a third catalog).
- [ ] **Trust from the page** — histogram, verified share, burst score, aspect_fit. Map through `trust_floor` (user-adjustable, default 0.5, persist on session).
- [ ] **IDs + specs** — ASIN / Walmart id / eBay id and spec tables in `parse_product`.
- [ ] **Reviews block** — quotes + “customers say” chips; no review pagination in v1.
- [ ] **CamelCamelCamel** — price-*change* series for Amazon ASINs (`history_camel.py` + fixtures). Only for shortlist ids. Do not block search.
- [ ] **CamelMart** — same change series for Walmart ids (`history_camelmart.py`).
- [ ] **Spec matrix axes** on `POST /market/compare` (incomplete ≠ win).
- [ ] **Top-10 diversity** — mix sites from the 50×3 pool; do not return ten Amazon-only rows.
- [ ] **Switch search ranking** in `synthesize.py` to `bang_per_buck × relevancy × trust_multiplier`.
- [ ] **UI** — compare sheet, trust-floor slider (recompute only), reel from `/api/top`, fist-confirm `synthesis.best`.
- [ ] **Client** — `compareItems` / `topItems` in `api.js` are uncalled.

## Implementation order

1. **IDs and specs.** Parse ASIN (`/dp/B0…`), Walmart `/ip/…/{id}`, spec tables. Tests from saved HTML, no live network.
2. **50-per-site recall.** Search-card parse, keep ~50 URLs each from Amazon, eBay, Walmart.
3. **Reviews block.** Histogram + a handful of quotes + aspect chips already on the page. No extra review-pagination in v1.
4. **`POST /market/compare` and `/market/top`.** Score = bang_per_buck × 1.0 × trust_multiplier. Top-10 from the 50×3 pool.
5. **CamelCamelCamel / CamelMart.** Change series for shortlisted Amazon/Walmart ids only. Fixtures for tests. Feed `hist_ref`.
6. **Relevancy (TODO).** Then **price/brand filters (future)** on that score.
7. **UI.** Two cards → compare sheet. Trust-floor slider recomputes without refetching history.
8. **Prompt-aware spec utility.** Camping boosts packed size and capacity inside bang-per-buck; laptop boosts RAM and warranty.

## Fetch rules

- History hosts are trackers of **past price changes**, not stores. Same posture as marketplace scrape: public pages, delay, no login, no captcha solving, cache by id.
- Do not request Camel/CamelMart for the full 50×3 pool. Shortlist only.
- If Camel or CamelMart blocks or has no row, `history.source = none` and bang-per-buck uses landed price only.
- Never block the planner on history.
- Prefer official product APIs later; Selenium + Camel/CamelMart is the hackathon path.

## UI sketch

```
[  Left listing     ]  [  Right listing    ]
  image + price          image + price
  90-day avg · low       90-day avg · low     ← sparkline from Camel / CamelMart

  Spec          A          B
  Packed size   7×22 in    8×24 in     A
  Capacity      2          2           tie
  Weight        4.8 lb     3.9 lb      B

  Reviews       4.6 / 18k  4.3 / 2k    A  “leaks in rain” on B
  Shipping      2-day      5 days      A
  History       +$8 vs avg at 90-day low  B

  Bang/buck 0.62   Relevancy 0.90 (todo)   Trust ×0.94 (floor 0.5)
  Score 0.53                               Score 0.31
  [ trust floor  |=====o-----|  0.5 ]
```

Green/red on the plan node still means purchased / not. Comparison winners use a quieter marker (check on the cell) so we do not reuse purchase colors.

## Done when

Each site contributes about 50 relevant search hits. Relevancy orders that pool (and later filters price and brand). Top-10 and A-vs-B run on the survivors. CamelCamelCamel and CamelMart add **price-change history** for Amazon/Walmart shortlist ids only. Headline `score = bang_per_buck × relevancy × trust_multiplier`. Relevancy is `1.0` until implemented. `trust_floor` defaults to 0.5. Missing history does not empty the view.
