# How to run tests

## Python unit tests

    pytest --cov=planner_lib --cov-report=term-missing --cov-report=html:coverage/htmlcov --cov-report=term --cov-report=lcov -q

coverage report dropped in `coverage/htmlcov`

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

Start the server:

    uvicorn planner:make_app --factory --reload 2>&1 |tee logfile.log

Run tests:
    npx playwright test --config=tests/playwright.config.js --project=firefox
or
    npx playwright test --config=tests/playwright.config.js --project=chromium
or
    npx playwright test --config=playwright.smoke.config.js --project=chromium

    To run with open browwser and pause execution:
    PWDEBUG=1 npx playwright test tests/e2e/featureboard-hierarchy.spec.mjs --headed

For browser / end-to-end tests use Playwright separately, e.g.:
    npx playwright test --config=playwright.smoke.config.js --project=chromium

# Run a session from CLI
export SESSION_ID=$(curl -s -X POST -H "Content-Type: application/json" -d '{"email":"user@example.com"}' localhost:8000/api/session | jq -r .sessionId)

echo "$SESSION_ID"

Create a configuration
    curl -s -X POST -H "Content-Type: application/json" \
      -d '{"email":"user@example.com", "pat":"YOUR PAT"}' \
      localhost:8000/api/session

Run browser based tests:
source .venv/bin/activate && npx playwright test [modal-interactions.spec.js](http://_vscodecontentref_/4) --config=playwright.smoke.config.js --project=chromium --reporter=list

# Planner REST calls:

Create a session
  export SESSION_ID=$(curl -s -X POST -H "Content-Type: application/json" -d '{"email":"user@example.com"}' http://localhost:8000/api/session | jq -r .sessionId)

curl -X GET  -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/health
curl -X POST -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/account
curl -X GET  -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/projects
curl -X GET  -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/tasks
curl -X POST -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/tasks
curl -X GET  -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/teams
curl -X GET  -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/scenario
curl -X GET  -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/scenario?id=
curl -X POST -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/scenario
curl -X POST -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/cost  # Return the cost JSON scheme
curl -X GET  -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/cost
curl -X POST -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/admin/reload-config
# assume session created and $SESSION_ID set and scenario id 'scen123' saved for the user
curl -s -X POST -H "X-Session-Id: $SESSION_ID" -H "Content-Type: application/json" \
  -d '{"scenarioId":"scen123"}' \
  http://localhost:8000/api/cost | jq .
  export SESSION_ID=$(curl -s -X POST -H "Content-Type: application/json" -d '{"email":"user@example.com"}' http://localhost:8000/api/session | jq -r .sessionId)
curl -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/cost | jq .
curl -s -X GET http://localhost:8000/api/cost | jq .

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
curl -X GET  -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/scenario

[{"id":"scen_1766146121427_4976","user":"user@example.com","shared":false}]

## Scenario GET data with scenario ID example:
curl -X GET  -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/scenario?id=scen_1766146121427_4976

{"id":"scen_1766146121427_4976","name":"12-19 Scenario 1","overrides":{"516154":{"start":"2025-10-24","end":"2025-11-23"},"516364":{"start":"2025-10-24","end":"2025-11-23"},"516412":{"start":"2025-10-24","end":"2025-11-23"},"516413":{"start":"2025-10-24","end":"2025-11-23"},"516419":{"start":"2025-10-24","end":"2025-11-23"},"534751":{"start":"2025-10-24","end":"2025-11-23"},"535825":{"start":"2025-10-24","end":"2025-11-23"},"682664":{"start":"2025-12-17","end":"2026-06-22"},"688048":{"start":"2026-04-19","end":"2026-05-19"},"688049":{"start":"2026-02-20","end":"2026-04-18"},"688050":{"start":"2025-12-26","end":"2026-02-19"},"688051":{"start":"2026-05-23","end":"2026-06-22"}},"filters":{"projects":["project-a","project-b"],"teams":["team-a","team-b","team-c","team-d"]},"view":{"capacityViewMode":"team","condensedCards":false,"featureSortMode":"rank"}}


## Run backend tests (not implemented)
python -m unittest tests/test_caching_client.py -v
python -m unittest discover -s tests -p "test_*.py" -v
