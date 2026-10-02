E2E Testing with Playwright

- Install Playwright browsers (once):

```bash
npm install -D @playwright/test
npx playwright install
```

- Run smoke tests

```bash
npx playwright test --config=tests/playwright.config.js
# Chromium variant
npx playwright test --config=tests/playwright.config.js --project=chromium
# Run single test file
npx playwright test tests/e2e/details-panel.editing.spec.js --config=tests/playwright.config.js --project=chromium
# Run headed
npx playwright test --config=tests/playwright.config.js --headed
# Run with Playwright inspector
npx playwright test --config=tests/playwright.config.js --debug
# Collect tracing
npx playwright test --config=tests/playwright.config.js --trace on
# then view with:
npx playwright show-trace trace.zip
```

- Run device/account workflows (isolated temporary storage):

```bash
npx playwright test --config=tests/playwright.auth.config.js
```

Notes:

- Build assets with `npm run build` before browser tests.
- The main config owns an isolated server on port 8010; auth tests use port 8017. Both refuse to reuse a running server and do not enroll into the active database.
- Main-suite database, generated data and cookie/local-storage state share a unique temporary directory per run; workers inherit the runner's directory.
- Allocation changes, card moves and card resizes require an active editable scenario. Use the scenario lifecycle helpers, assert persisted changes, and leave Baseline untouched.
- Tests are in `tests/e2e` and use `@playwright/test`.
- Firefox requires a Playwright-supported host; the installed runtime cannot install Firefox on Ubuntu 26.04. Keep launch failures distinct from workflow results.
- These are desktop workflows only. See [the testing guide](../docs/TESTING.md) for ownership, assertion policy and remaining coverage limitations.
