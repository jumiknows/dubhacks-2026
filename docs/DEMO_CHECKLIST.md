# Demo checklist

Use this checklist in the release pull request from `dev` to `main`.

- [ ] The demo goal and user flow are written down.
- [ ] A teammate can follow the README from a clean checkout.
- [ ] The application checks and repository CI pass.
- [ ] The main user flow works with the intended demo data.
- [ ] Loading, empty, error, and network failure states are checked where relevant.
- [ ] The target browser or device has been checked.
- [ ] Required environment variables are documented with example values.
- [ ] The presenter has a known working commit and a fallback recording or screenshots.
- [ ] Remaining limitations are stated in the release pull request.

Record the tested commit, environment, checks, and observed result. If deployed, also record the URL and rollback procedure. A tag or deployment is created only after the application and release process exist.
