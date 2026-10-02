# How to run tests

## Ownership and test types

Organize by the module or feature under test, not when coverage was added or an
architectural migration phase. Python suites live in `tests/python/<module>/`,
corresponding to `planner_lib/<module>`; CLI tests cover `scripts/api_cli.py`.
Migration suites remain in `tests/migrations/`.

JavaScript suites retain the `application`, `components`, `core`, `plugins` and
`services` owners under `tests/`. Application suites now mirror `commands/`,
`selectors/` and `shared/`; store/composition tests remain at their parent.
Node-only build configuration checks live in `tests/tooling/` and desktop
workflows in `tests/e2e/`. Timing measurements live in `tests/performance/`.
`setup/`, `helpers/`, `fakes/`, `fixtures/` and `msw/` are harness/data, not suites.

Name files after the owner and behavior, for example
`details-panel.editing-commands.test.js` or `test_cookie_auth_contract.py`.
Do not use `more`, `extra`, `additional`, `coverage`, `lowcoverage`, `expanded`
or `phaseN` as a catch-all suffix. Domain concepts such as "extra fields" are
different from "extra tests".

### Assertion policy

- **Contracts:** exercise public APIs, commands, selectors, providers or
    component interactions. Assert meaningful output, status, persisted data,
    ownership, errors and signals, including invalid and boundary cases.
- **Algorithms:** retain focused accounting, scheduling, ordering, hierarchy
    and geometry invariants. Private access alone does not justify deleting
    valuable correctness coverage.
- **Characterization:** private handler/cache tests are not automatically
    interface contracts. Prefer DOM interactions or public seams when changing
    them; a descriptive rename does not improve their assertions.
- **Integration:** use real collaborating services with temporary storage.
    Stub dependencies, not the implementation under test. A fake implementing
    production logic does not prove that production logic works.
- **Performance:** state the workload and budget, and record measurements.
    Keep machine-speed assertions out of correctness tests. Deadlock safety
    timeouts in synchronization tests are not throughput budgets.

Remove a test only when vacuous, duplicated, retired or behaviorally replaced.
Lower counts are acceptable; losing a unique contract is not. Public-boundary
mock calls are valid assertions when delegation, isolation or avoiding remote
I/O is the requirement; incidental internal helper-call order is not.

### Cleanup decisions

- Split architecture catch-alls into protocols, admin reload, cache coordinator,
    health, Azure invalidation and composition suites. Retained required public
    registration contracts, not private registry counts or router-prefix placement.
- Replaced store import/class-existence checks with scenario/view CRUD,
    metadata, owner isolation and namespace isolation against temporary diskcache.
- Retained account validation, encryption, identity and restore coverage;
    replaced namespace-flattening fakes with real in-memory storage.
- Replaced `detail=str(e)` source matching with five injected-service HTTP
    failures asserting generic responses and no secret/path disclosure.
- Board navigation/insertion now checks scrolling, highlights and DOM output;
    capacity edits check the full command payload and baseline immutability.
- Removed duplicate drag/order checks and the unconditional historical DST
    placeholder with its unused buggy-code copy. Retained actual positioning
    and exported drag-calculation checks.
- Replaced permissive email/header-session admin tests with exact cookie-auth
    authorization outcomes. Scenario-group tests enroll an isolated owner first.
    Removed a fake-only snapshot test; real admin-service snapshot coverage
    remains in `test_service_configuration.py`.
- Retired the external-server endpoint sweep, which attempted arbitrary writes
    and deletes using unsupported auth. Isolated API and browser authentication
    tests cover the current boundary without touching active deployment data.
- Replaced the mixed timing/write-race suite with barrier-based read overlap,
    exact concurrent-save persistence checks and an opt-in throughput benchmark.
    Cache nonblocking behavior uses a blocked refresh, not a 200 ms assertion.
- Split Node tooling from jsdom and moved setup out of `.test.js` files.
    Mechanical moves preserve relative imports and mock targets.
- Desktop allocation, move, resize and shrinkwrap contracts create and activate
    an editable scenario first, assert exact persisted values, and verify that
    Baseline is unchanged. No direct-style drag fallback or data-dependent
    details-panel skip is accepted as evidence of an edit.
- Browser bootstrap verifies task/project reads after mock initialization. The
    generator preserves project schema and container metadata on reconnect;
    browser storage state is isolated alongside the per-run database.

### Remaining risks

This is not a claim that every retained assertion is a contract. Prioritize:

1. Keep root Python fixtures function-scoped and isolated. HTTP tests must use
    anonymous `client` or explicitly enrolled `authenticated_client`; do not
    reintroduce global authentication patches or shared service restoration.
2. Some components still use private handlers; the UTC date suite retains a
     copied drag-conversion simulation. Replace those with DOM interactions or
     the actual exported drag entry point rather than another implementation copy.
3. Review the skipped drag/resize DOM suite against the active, scenario-aware
    browser coverage before deleting or reviving it. Some inherited browser
    checks still inspect manually simulated DOM (for example the dim-info
    suite); a passing suite alone does not make those assertions contracts.
4. `MemoryStorage.delete` ignores missing items, unlike diskcache's `KeyError`;
     facade missing-delete results therefore differ. Persistence contracts use
     diskcache. Resolve the production contract before asserting backend parity.
5. The manual cache-measurement script in `scripts/` still injects historical
     Azure client internals. It is not a collected/certified benchmark; use the
     new throughput suite for automated measurements.
6. Firefox validation requires a Playwright-supported host. The installed
    Playwright runtime cannot install Firefox on Ubuntu 26.04; this is a
    browser-launch blocker, not passing or skipped workflow coverage.

## Python unit tests

        source .venv/bin/activate
        pytest
        pytest tests/python/accounts
        pytest tests/python/backend/test_backend_contract.py
        pytest --collect-only

Default correctness runs exclude `performance`-marked measurements. Select:

        pytest tests/performance -m performance
        pytest tests/performance -m performance --junitxml=test-results/performance.xml -o junit_family=legacy

The report records sequential/concurrent seconds and their ratio. For four
requests with 100 ms simulated I/O, the benchmark requires concurrent duration
below 75% of sequential duration. Correctness runs do not depend on that budget.

    pytest --cov=planner_lib --cov-report=term-missing --cov-report=html:coverage/htmlcov --cov-report=term --cov-report=lcov -q

coverage report dropped in `coverage/htmlcov`

Every HTTP test uses production cookie authentication. The function-scoped `client`
is anonymous; `authenticated_client` enrolls an isolated account through
`/api/auth/enroll` and uses its issued cookies. Security suites may retain the
`real_auth` marker for selection, but no marker changes authentication behavior.
Handler-only unit tests may register explicit identity and credential dependencies.

## JavaScript unit tests

Without coverage:
    npm test

Focused runs:
    npm test -- tests/application/commands
    npm test -- tests/components/details-panel.editing-commands.test.js
    npm test -- --project node

Vitest runs jsdom/MSW component/domain suites and Node tooling with separate
setup. Both projects participate in `npm test` and coverage.

With coverage:
    npm run test:coverage
    npm test -- --coverage

coverage report dropped on `coverage/lcov-report`

Run interactive UI/debug mode
    npm run test:ui

## JavaScript UI tests

Build frontend assets first if `dist/` doesn't exist:

    npm run build

Allocation updates and moving/resizing cards require an active editable
scenario. Use the `activeScenario` fixture or `createScenario` and
`activateScenario` helpers in `tests/e2e/helpers.js`; API-seeded full records
must carry an explicit unique `id`, not only `_meta.id`. Save through the
scenario menu and check the persisted result. Baseline is readonly and is
tested for immutability, never used as a successful editing fixture.

Run tests:
    npx playwright test --config=tests/playwright.config.js --project=firefox
or
    npx playwright test --config=tests/playwright.config.js --project=chromium

    To run with open browser and pause execution:
    PWDEBUG=1 npx playwright test tests/e2e/featureboard-hierarchy.spec.mjs --headed

Notes:
- `tests/playwright.config.js` starts an isolated uvicorn server on `127.0.0.1:8010`.
- The Playwright web server sets a dedicated `PLANNER_SECRET_KEY` for account PAT encryption in tests.
- E2E storage and generated mock data use a fresh temporary directory per run, passed through `PLANNER_E2E_TEST_DATA_DIR` and Playwright metadata. Existing test databases and the repository `data/` are not modified.

## UI/UX v5 release validation

Run the focused presentation-scope suites first, followed by the broad checks:

    npx vitest run tests/application/selectors/scopeSelectors.test.js tests/components/sidebar.tasktype.test.js tests/components/empty-board-modal.scope.test.js tests/components/maingraph.test.js tests/services/swimlaneService.test.js tests/plugins/plugin-graph.test.js tests/plugins/plugin-markers.test.js tests/plugins/plugin-portfolio.selector-contract.test.js tests/plugins/plugin-plan-health-checks.test.js tests/plugins/plugin-dependencies.lifecycle-contract.test.js
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

To calculate a saved or local scenario, derive its effective features on the client
and POST { "features": [ ...effective features with overrides...] } to
`/api/cost/features`. The legacy POST `/api/cost` route and override-array request
format have been removed; `scenarioId` alone no longer requests recalculation.
Send the full features list where each item has keys: id, project, start, end, capacity, plus optional title, type, state.

**IMPORTANT**: `capacity` must be a list of team allocations: `[{"team": "team-name", "capacity": 80}, ...]`
- Empty list `[]` is valid (feature has no capacity allocated)
- Float values like `1.0` are **NOT** valid and will cause `'float' object is not iterable` error
- The backend `list_tasks()` always returns capacity as a list

GET /api/cost is fine for baseline cached result when session is authenticated.


## Scenario POST data example:
{"op":"save","data":{"id":"scen_1766146121427_4976","name":"12-19 Scenario 1","overrides":{"516154":{"start":"2025-10-24","end":"2025-11-23"},"516364":{"start":"2025-10-24","end":"2025-11-23"},"516412":{"start":"2025-10-24","end":"2025-11-23"},"516413":{"start":"2025-10-24","end":"2025-11-23"},"516419":{"start":"2025-10-24","end":"2025-11-23"},"534751":{"start":"2025-10-24","end":"2025-11-23"},"535825":{"start":"2025-10-24","end":"2025-11-23"},"682664":{"start":"2025-12-17","end":"2026-06-22"},"688048":{"start":"2026-04-19","end":"2026-05-19"},"688049":{"start":"2026-02-20","end":"2026-04-18"},"688050":{"start":"2025-12-26","end":"2026-02-19"},"688051":{"start":"2026-05-23","end":"2026-06-22"}},"filters":{"projects":["project-a","project-b"],"teams":["team-a","team-b","team-c","team-d"]},"view":{"capacityViewMode":"team","condensedCards":false,"featureSortMode":"rank"}}}

## Scenario GET data example:
curl -s -b "$HOME/planner-cookies.txt" "$API_BASE/api/scenario"

[{"id":"scen_1766146121427_4976","user":"11111111-1111-4111-8111-111111111111","shared":false}]

## Scenario GET data with scenario ID example:
curl -s -b "$HOME/planner-cookies.txt" "$API_BASE/api/scenario?id=scen_1766146121427_4976"

{"id":"scen_1766146121427_4976","name":"12-19 Scenario 1","overrides":{"516154":{"start":"2025-10-24","end":"2025-11-23"},"516364":{"start":"2025-10-24","end":"2025-11-23"},"516412":{"start":"2025-10-24","end":"2025-11-23"},"516413":{"start":"2025-10-24","end":"2025-11-23"},"516419":{"start":"2025-10-24","end":"2025-11-23"},"534751":{"start":"2025-10-24","end":"2025-11-23"},"535825":{"start":"2025-10-24","end":"2025-11-23"},"682664":{"start":"2025-12-17","end":"2026-06-22"},"688048":{"start":"2026-04-19","end":"2026-05-19"},"688049":{"start":"2026-02-20","end":"2026-04-18"},"688050":{"start":"2025-12-26","end":"2026-02-19"},"688051":{"start":"2026-05-23","end":"2026-06-22"}},"filters":{"projects":["project-a","project-b"],"teams":["team-a","team-b","team-c","team-d"]},"view":{"capacityViewMode":"team","condensedCards":false,"featureSortMode":"rank"}}


# Test harness

Mock network requests using Mock Service Worker (MSW): https://vitest.dev/guide/mocking/requests.  See `tests/msw/` for the mock.