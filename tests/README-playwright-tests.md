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
npx playwright test tests/e2e/some.test.js --config=tests/playwright.config.js
# Run headed
npx playwright test --config=tests/playwright.config.js --headed
# Run with Playwright inspector
npx playwright test --config=tests/playwright.config.js --debug
# Collect tracing
npx playwright test --config=tests/playwright.config.js --trace on
# then view with:
npx playwright show-trace trace.zip
```
- Run e2e tests (starts the local dev server via `uvicorn`):
```bash
npm run test:e2e
```

Notes:
- The Playwright config `playwright.config.js` starts `uvicorn planner:app --reload --port 8001` before tests. Ensure your environment has Python and `uvicorn` installed.
- Tests are in `tests/e2e` and use `@playwright/test`.
