# How to compare marketplace listings

The planner asks Python for listings, then scores each one. Price alone is a bad pick: a $30 tent with three reviews and a two-week ship window can beat a $79 Prime tent on a sort-by-price table and still be the worse buy.

The live scorer in `api/market/synthesize.py` is a weighted sum. Weights can be overridden per request.

## Factors in the current algorithm

| Factor | What it captures | Signal |
|---|---|---|
| **Value** | Price versus the cohort median, not the cheapest SKU | Unit price; penalty if the price is far below the median (“too cheap”) |
| **Trust** | Whether the offer is likely real and as described | Star rating, review volume, seller rating, known storefront (Amazon/Walmart vs unnamed eBay seller) |
| **Shipping** | When it actually arrives | Parsed delivery days; Prime / two-day bonus |
| **Availability** | Can we buy it now | In-stock vs outbound |
| **Fit** | Is this the thing the prompt asked for | Token overlap between the plan item name and the listing title |
| **Condition** | New vs refurbished vs used | Listing condition. Used can still win if value + trust stay high |
| **Completeness** | How much of the card we can show | Image, dimensions, shipping, rating, URL present |

Default mix: value 28%, trust 22%, shipping 15%, fit 13%, availability 12%, condition 5%, completeness 5%.

## Other axes worth adding later

These are not in the scorer yet. Each can become a 0–1 term with a small weight, or a hard filter.

**Trust / risk**
- Verified-purchase share and review velocity (bursts look fake)
- Return rate or “item not as described” flags
- Seller age and country
- Counterfeit-prone categories (cables, cosmetics, batteries) get a higher trust floor
- Exact-image reuse across unrelated ASINs
- Warranty / authorized dealer

**Money**
- Landed cost: item + tax + shipping + membership (Prime, Walmart+)
- Price-per-unit or per-use (cost per night for a tent, cost per watt for a charger)
- Historical price (is this a fake “was $200”)
- Restocking fees and return shipping
- Bundle extras that actually match the plan (stakes included)

**Time**
- Cutoff hour for same-day
- Ship-from vs sold-by split
- Backorder vs “in stock nearby”
- Weekend delivery

**Fit / quality**
- Spec match: capacity, size, material, voltage
- Dimensions vs packing constraint from the prompt (“fits in a sedan”)
- Weight
- Compatibility (USB-C vs Lightning)
- Energy / nutrition for groceries

**Experience**
- Q&A “does this leak?” style complaints
- Photo vs stock image
- Noise, smell, assembly time from reviews (needs NLP)
- Accessibility (one-handed setup)

**Policy**
- Marketplace ToS and whether we even have a right to show the URL
- Restricted items
- User budget as a hard filter, not a score

## How the pipeline uses this

1. The Express server posts each plan-item name to `POST /market/search`.
2. Python either runs Selenium (search page → product pages) or returns fixtures.
3. `POST /market/synthesize` ranks those products and returns `best`, `alternatives`, and a `scores` breakdown the UI can show as a radar or as “why this one.”

Turn on live fetch with `SELENIUM_ENABLED=true` in `api/.env`. Keep it off in CI. Marketplaces often block datacenter browsers; official product APIs are the durable replacement for Selenium.
