# How to run tests

## Python unit tests

    pytest --cov=planner_lib --cov-report=term-missing --cov-report=html:coverage/htmlcov --cov-report=term --cov-report=lcov -q

coverage report dropped in `coverage/htmlcov`

Authentication-sensitive Python suites must use `pytestmark = pytest.mark.real_auth`
or mark individual tests with `@pytest.mark.real_auth`. This disables the legacy
`ensure_test_sessions` bypass; enroll through `/api/auth/enroll` and use the issued
cookies. Handler-only unit tests may register explicit session stubs, but must send
cookie headers and provide the session fields consumed by the handler.

## JavaScript unit tests

Withot coverage:
    npm test

With coverage:
    npm run test:coverage
    npm test --coverage

coverage report dropped on `coverage/lcov-report`

Run interactive UI/debug mode
    npm run test:ui

## JavaScript UI tests

Build frontend assets first if `dist/` doesn't exist:

    npm run build

Run tests:
    npx playwright test --config=tests/playwright.config.js --project=firefox
or
    npx playwright test --config=tests/playwright.config.js --project=chromium

    To run with open browser and pause execution:
    PWDEBUG=1 npx playwright test tests/e2e/featureboard-hierarchy.spec.mjs --headed

Notes:
- `tests/playwright.config.js` starts an isolated uvicorn server on `127.0.0.1:8010`.
- The Playwright web server sets a dedicated `PLANNER_SECRET_KEY` for account PAT encryption in tests.
- E2E storage is isolated under `tests/e2e/.tmp-data` so test runs do not modify the repository `data/` directory.

## UI/UX v5 release validation

Run the focused presentation-scope suites first, followed by the broad checks:

    npx vitest run tests/application/scopeSelectors.test.js tests/components/sidebar.tasktype.test.js tests/components/empty-board-modal.scope.test.js tests/components/maingraph.test.js tests/swimlaneService.test.js tests/plugins/plugin-graph.test.js tests/plugins/plugin-markers.test.js tests/plugins/plugin-portfolio.phase4.test.js tests/plugins/plugin-plan-health-checks.test.js tests/plugins/plugin-dependencies.phase4.test.js
    npm test
    npm run test:coverage
    pytest
    xvfb-run -a npx playwright test --config=tests/playwright.config.js --project=chromium

Acceptance requires no top-bar Teams menu or Sidebar expansion controls, exact
Data Funnel counts under Scope and Team Drill-down changes, stable organization
graph values under display filtering, Context-owned dependency lifecycle, and
traceable source-plan lanes for Other allocations.

# Authenticated CLI and browser tests

Email-only sessions and X-Session-Id are not supported. Enroll a dedicated CLI
browser and save its replacement account key privately:

```bash
export API_BASE=http://localhost:8001
python3 -m scripts.api_cli enroll user@example.com --name 'Example User' \
    --cookies "$HOME/planner-cookies.txt" --key-output "$HOME/planner-account-key.txt"
python3 -m scripts.api_cli get /api/projects --cookies "$HOME/planner-cookies.txt"
```

Keep credential files outside the repository and do not log their contents.
Routine calls renew from the cookie jar without consuming the account key.
Use a private JSON file for PAT configuration payloads and POST it to
`/api/config`, never to `/api/session`.

```bash
python3 -m scripts.api_cli post /api/config --cookies "$HOME/planner-cookies.txt" -d @private-config.json
curl -s -b "$HOME/planner-cookies.txt" -c "$HOME/planner-cookies.txt" \
    -X POST -H 'Accept: application/json' "$API_BASE/api/session"
curl -s -b "$HOME/planner-cookies.txt" -H 'Accept: application/json' "$API_BASE/api/cost"
```

The dedicated authentication E2E uses isolated temporary storage and desktop
browser contexts; it never reads or resets the active `data/` database:

```bash
npm run build
npx playwright test --config=tests/playwright.auth.config.js
```

# Cost scenario
Practical client-side rules (what you should send)

To calculate a server-stored scenario: POST { "scenarioId": "<id>" }
This lets the server load the scenario and apply overrides, and response meta will show scenario_id and applied_overrides.
To calculate a local/unsaved scenario (temporary overrides applied on the client): POST { "features": [ ...effective features with overrides...] }
Send the full features list where each item has keys: id, project, start, end, capacity, plus optional title, type, state.

**IMPORTANT**: `capacity` must be a list of team allocations: `[{"team": "team-name", "capacity": 80}, ...]`
- Empty list `[]` is valid (feature has no capacity allocated)
- Float values like `1.0` are **NOT** valid and will cause `'float' object is not iterable` error
- The backend `list_tasks()` always returns capacity as a list

Response meta.scenario_id will be null (unless you also pass a scenarioId).
GET /api/cost is fine for baseline cached result when session is authenticated.


## Scenario POST data example:
{"op":"save","data":{"id":"scen_1766146121427_4976","name":"12-19 Scenario 1","overrides":{"516154":{"start":"2025-10-24","end":"2025-11-23"},"516364":{"start":"2025-10-24","end":"2025-11-23"},"516412":{"start":"2025-10-24","end":"2025-11-23"},"516413":{"start":"2025-10-24","end":"2025-11-23"},"516419":{"start":"2025-10-24","end":"2025-11-23"},"534751":{"start":"2025-10-24","end":"2025-11-23"},"535825":{"start":"2025-10-24","end":"2025-11-23"},"682664":{"start":"2025-12-17","end":"2026-06-22"},"688048":{"start":"2026-04-19","end":"2026-05-19"},"688049":{"start":"2026-02-20","end":"2026-04-18"},"688050":{"start":"2025-12-26","end":"2026-02-19"},"688051":{"start":"2026-05-23","end":"2026-06-22"}},"filters":{"projects":["project-a","project-b"],"teams":["team-a","team-b","team-c","team-d"]},"view":{"capacityViewMode":"team","condensedCards":false,"featureSortMode":"rank"}}}

## Scenario GET data example:
curl -s -b "$HOME/planner-cookies.txt" "$API_BASE/api/scenario"

[{"id":"scen_1766146121427_4976","user":"11111111-1111-4111-8111-111111111111","shared":false}]

## Scenario GET data with scenario ID example:
curl -s -b "$HOME/planner-cookies.txt" "$API_BASE/api/scenario?id=scen_1766146121427_4976"

{"id":"scen_1766146121427_4976","name":"12-19 Scenario 1","overrides":{"516154":{"start":"2025-10-24","end":"2025-11-23"},"516364":{"start":"2025-10-24","end":"2025-11-23"},"516412":{"start":"2025-10-24","end":"2025-11-23"},"516413":{"start":"2025-10-24","end":"2025-11-23"},"516419":{"start":"2025-10-24","end":"2025-11-23"},"534751":{"start":"2025-10-24","end":"2025-11-23"},"535825":{"start":"2025-10-24","end":"2025-11-23"},"682664":{"start":"2025-12-17","end":"2026-06-22"},"688048":{"start":"2026-04-19","end":"2026-05-19"},"688049":{"start":"2026-02-20","end":"2026-04-18"},"688050":{"start":"2025-12-26","end":"2026-02-19"},"688051":{"start":"2026-05-23","end":"2026-06-22"}},"filters":{"projects":["project-a","project-b"],"teams":["team-a","team-b","team-c","team-d"]},"view":{"capacityViewMode":"team","condensedCards":false,"featureSortMode":"rank"}}


## Run backend tests (not implemented)
python -m unittest tests/test_caching_client.py -v
python -m unittest discover -s tests -p "test_*.py" -v


# Test harness

Mock network requests using Mock Service Worker (MSW): https://vitest.dev/guide/mocking/requests.  See `tests/msw/` for the mock.