# Demo checklist

Use this checklist in the release pull request from `dev` to `main`. Current evidence is for application source `8d4ef4e94f1823d5d854a4925b5a8aaf33663a7a`. See [release readiness](RELEASE_READINESS.md) for the private URL, CI run, source dataset and rollback version.

- [x] The demo goal and user flow are written down in PRODUCT_BRIEF.md and DEMO_SCRIPT.md.
- [ ] A teammate can follow the README from a clean checkout.
- [x] The application checks and repository CI pass, including 46 unit/integration tests, nine browser tests and 17 repository tests.
- [x] The replay flow works with the real NASA archive. Live observations and exact context passed hosted HTTP checks separately.
- [x] Loading, empty, error, and network failure states are checked, including WebGL and tile failure and late speech cancellation.
- [x] Chromium desktop and 390-pixel mobile layout passed in CI.
- [x] Required environment variables and private Voice access are documented in apps/web/README.md and its environment example.
- [ ] The presenter has a known working commit and a fallback recording or screenshots.
- [x] Remaining limitations and exact evidence are stated in RELEASE_READINESS.md and implementation PR #44.
- [ ] The owner has checked the deployed origin in a clean browser, including sign-in and microphone permission.
- [x] Actual Grok speech and a grounded conversation execute with a privately configured key.
- [ ] Provider account budget controls are confirmed by the account owner.
- [ ] Actual briefing outputs have human review in #32.
- [ ] The complete demo, including real Grok, passes three clean rehearsals in #23.
- [ ] The organizer's deadline and sponsor evidence are confirmed in #11 and #24.

The three automated replay rehearsals are complete. They do not replace the full Voice rehearsals or teammate handoff. CI screenshots are available as `browser-evidence` in the linked run, but the presenter has not confirmed receiving them. Keep the release draft until the remaining human and provider gates pass.
