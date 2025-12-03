# Getting started

- Install Python 3.13 or later
- Install requirements vor virtual environments
  `sudo apt install python3.13-venv`
- Create the virtual environment for the project
  `python3 -m venv .venv`
- Activate the environment (do this every time in the console window where you need to run the application)
  `source .venv/bin/activate`
  **Tip:** To leave the venv, type the command `deactivate` (but why would you?)
- Install project requirements
  `pip install -r requirements.txt`
- Run the server
  `uvicorn planner:app --reload`
- Use the application by browsing to `http://localhost:8000`

The server will run a setup first time. If you need to run the setup again, either delete the `data/config/server_config.yml` file or run `python3 planner.py --setup`.

# Testing

- Install code coverage tool
  `npm install --save-dev c8`
- Run the tests with coverage
  `npx c8 node scripts/run_js_tests.mjs`
- Run tests without coverage
  `node ./scripts/run_js_tests.mjs`

## Run a sessino from CLI
export SESSION_ID=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}' \
  localhost:8000/api/session | jq -r .sessionId)

echo "$SESSION_ID"

Create a configuration
    curl -s -X POST -H "Content-Type: application/json" \
      -d '{"email":"user@example.com", "pat":"YOUR PAT"}' \
      localhost:8000/api/session

Run some requests
    curl -s -H "X-Session-Id: $SESSION_ID" localhost:8000/api/projects
    curl -s -H "X-Session-Id: $SESSION_ID" localhost:8000/api/tasks
    curl -s -H "X-Session-Id: $SESSION_ID" localhost:8000/api/teams


# WIP - Planner REST calls (not implemented):

  curl http://localhost:8000/offline/work-items
  curl http://localhost:8000/
  curl -X POST http://localhost:8000/config/refresh
  curl http://localhost:8000/area-paths
  curl http://localhost:8000/area-paths/tree
  curl http://localhost:8000/area-paths/projects
  curl http://localhost:8000/area-paths/teams
  curl http://localhost:8000/health
  curl http://localhost:8000/config
  curl "http://localhost:8000/work-items?paths=Platform_Development\\eSW\\Teams\\Architecture"
  curl -s localhost:8000/plan
  curl -s -X POST localhost:8000/plan -H 'Content-Type: application/json' -d '{"colors":{"type:Feature":"#00ff00"}}'
  curl -s -X POST localhost:8000/plan/move -H 'Content-Type: application/json' -d '{"id":1,"new_area_path":"Proj\\TeamB"}'
  curl -s -X DELETE localhost:8000/plan/reset

## Run backend tests (not implemented)
python -m unittest tests/test_caching_client.py -v
python -m unittest discover -s tests -p "test_*.py" -v
