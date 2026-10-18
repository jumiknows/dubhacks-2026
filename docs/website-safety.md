# Website safety: implementation and handoff

Website reputation is separate from product quality, review sentiment, catalog
approval and payment authorization. The new gate returns **blocked**, **hold**, or
**allowed for a specific action**. It never returns a merchant safety guarantee.

## Try it

Start the existing app with `npm.cmd run dev` on Windows, then open:

**http://localhost:3001/api/conjure/websites/workbench**

Direct FastAPI: `http://localhost:8000/websites/workbench`.

Click **Run synthetic demonstration** to compare identity mismatches, a possible
lookalike, a simulated phishing report and an unavailable provider. This is labeled
synthetic and uses an isolated service; it cannot authorize real requests or checkout.
The review workbench now offers source assessments instead of unassessed outbound
links. Neither workbench automatically opens a submitted destination.

## Decision rules

1. Reject ambiguous URLs, credentials, IP literals, unsupported ports, non-HTTPS,
   login/reset paths, fragments and recognizable private query parameters. Parsing
   failures do not contact a provider. This privacy filter is conservative, not a
   general detector of secrets in arbitrary paths: submit public product URLs only.
2. Match the **exact origin** against an operator-maintained merchant registration.
   `https://merchant.com.attacker.com` does not match `https://merchant.com`.
   Subdomains and payment origins require their own explicit registration.
3. Check configured reputation providers using fixed HTTPS endpoints. A current
   threat match blocks; an unresolved report, timeout, malformed response, rate
   limit, missing configuration or partial provider failure holds the action.
   When several providers are enabled, all must return no known threat to proceed.
4. An allowed action additionally needs public-only DNS results. The review client
   independently validates addresses, pins the connection IP and retains the
   original TLS hostname for certificate verification. It follows no redirects.
5. Return evidence, purpose, origin, URL hash, timestamps, provider coverage and
   limitations. Successful lookups are cached for at most five minutes and never
   beyond a provider's expiry. Unknown results have a short retry cache.

Lookalike spelling and encoded international hostnames are warnings, not proof of
fraud. An unregistered site cannot become allowed merely because a threat list has
no match. The gate does not visit target pages or issue certificate-validation claims;
the client making an actual connection must validate TLS and any new destination.

## Configure live checks locally

No credentials or local `.env` files were changed by this feature. Restart Python
after setting configuration. The following is a **placeholder**, not an approved store:

```dotenv
REVIEW_WOOCOMMERCE_STORES='{"shop":"https://shop.example.com"}'
WEBSITE_MERCHANTS='{"shop":{"origins":["https://shop.example.com"]}}'
WEBSITE_PHISHTANK_ENABLED=true
```

Replace the origin with the store's established official HTTPS origin. The review
store key and website merchant key must match. A human must establish the domain
mapping through a trusted source; this code does not certify business identity.
Review retrieval now **holds** unless both identity and reputation requirements
are met. Uploaded-review analysis and synthetic demonstrations still work offline.

PhishTank supports optional application keys. Keyless lookups have stricter limits;
set `WEBSITE_PHISHTANK_API_KEY` locally only if you already have an application key.
This adapter requires HTTPS and never downgrades to the HTTP URL in older docs.
PhishTank checks reported phishing, not general malware or seller reliability.

Optional additional coverage:

```dotenv
WEBSITE_WEBRISK_API_KEY=YOUR_SEPARATELY_CONFIGURED_WEB_RISK_KEY
```

Google Cloud Web Risk needs its own enabled API and suitable server credentials;
the Gemini model key is not automatically a Web Risk integration. The adapter sends
the key in a header, never the query string. Web Risk queries social engineering,
malware and unwanted software lists. It has not been live-tested with a real key here.
Provider configuration is opt-in and can involve provider quotas or charges.

Other settings: `WEBSITE_BLOCKED_HOSTS` (JSON list of bare hostnames),
`WEBSITE_LOOKUP_TIMEOUT_S` (default 5), `WEBSITE_CACHE_TTL_S` (default/max 300),
`WEBSITE_LOOKUP_REQUESTS_PER_MINUTE` (default 30). The process-local budget counts
lookup jobs; each job can call both providers. Four lookups may run concurrently.
These bounds are not deployment authentication or a distributed spending quota.

## API contract

Express adds `/api/conjure` to these FastAPI endpoints:

- `POST /websites/assess`: `{ "url": "https://shop.example.com/product", "merchant_id": "shop", "purpose": "link" }`.
  Purposes are `fetch`, `link` or `checkout`. A unique registered origin can infer
  the merchant for link/fetch, never checkout. The result does not execute an action.
- `POST /websites/checkout-check`: `{ "merchant_id": "shop" }`. The server supplies
  the exact configured checkout URL; browsers cannot choose a payment destination.
- `GET /websites/config`: public registration metadata and configured provider
  categories, never credentials. Configured does not mean reachable or successful.
- `POST /websites/demo`: isolated synthetic cases, no provider or merchant traffic.
- `GET /websites/workbench`: self-contained browser UI, no frontend API keys.

Assessment responses expose only the origin and URL hash, not the submitted path,
query, fragment or credential values. Validation errors withhold input values too.
The existing streaming one-MiB body cap covers these routes and the gateway permits
only fixed endpoint/method combinations. Do not put submitted URLs in access-log
queries: the API uses JSON POST bodies.

## Integration and checkout boundaries

- `api/websites/urls.py`: strict parsing and bounded lookalike warnings.
- `reputation.py`: provider adapters, strict bounded JSON and sanitized failures.
- `service.py`: identity, DNS, reputation, caching, limits and action decisions.
- `checkout.py`: bridge to the existing signed-cart policy.
- `routes.py`, `models.py`, `workbench.html`: API, contracts and demonstration.
- `api/reviews/routes.py`: always constructs the public source service with this gate.
  `api/reviews/sources.py` checks every merchant HTTP URL before requesting it and
  every product permalink before returning it. Cached links are rechecked. A blocked
  or held response has no analysis or usable product links. Successful product-link
  assessments accompany the source metadata; they are not merchant certificates.

For a catalog merchant with an external destination, extend its registration with
`checkout_url` and optional `payment_origins`. Checkout origins must appear either
in `origins` or in the explicit payment list. Payment origins are not approved for
product/review fetching. Use a stable public destination without customer tokens.

HTTP `/checkout/stage` automatically preflights configured destinations. The
synchronous agent staging tool requires `/websites/checkout-check` first; without
fresh evidence it refuses. The exact server destination map is bound into the
signed cart payload. Authorization checks for destination/configuration changes,
expiry and a newly recorded adverse assessment before creating the mock intent.
Expired evidence requires another check and possibly restaging/signing the cart.

**Payments are still mock.** Existing fictional catalog merchants without external
registrations retain mock checkout with an explicit no-external-verification policy
message. Before introducing a real payment provider, remove that mock exception and
require a registered, freshly checked destination for every actual external charge.
No source adapter can supply a payment URL or bypass the customer's signed consent.

The shared Product schema, recommendation formulas, sentiment math and Node fixture
planner remain unchanged. The Node planner currently uses demo fetches; this feature
does not retrofit unrelated live fetchers on other branches. Teammates must use the
gate at each new external HTTP/link/payment boundary, recheck redirect destinations,
and preserve TLS/IP pinning rather than relying on an earlier UI assessment.

## Verification and practical limits

- Offline regression: **647 Python + 23 Node tests**, including 108 Python website cases.
  Tests cover private networks, deceptive URL forms, provider failures, cache/expiry,
  signature-bound checkout destinations, no HTTP on hold, cached review rechecks,
  sanitized API errors, isolated demos and fixed gateway routes.
- Live read-only check on 2026-10-18: keyless HTTPS PhishTank returned a parsed result
  for two public URLs. One unresolved/historical report produced a hold-worthy
  `reported` result; the other was `no_known_threat`. Neither is merchant verification.
- A separately constructed, in-memory gated source successfully retrieved **3 public
  reviews** for `nopong`, WooCommerce product `616`, from `https://www.nopong.com.au`;
  the source claimed 12 total. No keys, configuration or catalog data were changed.
- Frontend production build, both workbench script syntax checks and the real localhost
  gateway smoke checks passed, including the new safety routes and offline chat.
  Browser visual interaction was not exercised in this environment.

There is no automatic business ownership verification, domain-age scoring, full
Unicode impersonation detector, page-content scan or guarantee against a compromised
legitimate merchant. New threats may be absent from provider lists. Cached evidence
has a short detection delay. A browser following a later redirect is a new boundary;
these workbenches do not navigate to external sites. Avoid inventing a numerical
"website trust score" from these incomplete signals.

Provider references: [PhishTank API](https://www.phishtank.org/api_info.php),
[Google Web Risk lookup](https://docs.cloud.google.com/web-risk/docs/lookup-api),
[Google system parameters](https://docs.cloud.google.com/apis/docs/system-parameters).
Security guidance: [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html),
[OWASP redirects](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html).
