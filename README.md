# Getting started - development

- Install Python 3.13 or later
- Install requirements for virtual environments
  `sudo apt install python3.13-venv`
- Create the virtual environment for the project
  `python3 -m venv .venv`
- Activate the environment (do this every time in the console window where you need to run the application)
  `source .venv/bin/activate`
  **Tip:** To leave the venv, type the command `deactivate` (but why would you?)
- Install project requirements
  `pip install -r requirements.txt`
- Run the server
  `uvicorn planner:make_app --factory --reload 2>&1 |tee logfile.log`
  **Tip:** you can leave out the pipe to the logfile if you don not want a file log.
- Use the application by browsing to `http://localhost:8000`

# Getting started - deployment: Installing the backend in Proxmox LXC

Install Proxmox 9.x . Debian 13 is not supported on Proxmox 8.x.
Use a template, here we use Debian 13.x as the base
Setup the LXC, give it the reasonable settings (or 2 CPU, 512 MB RAM, 8 GB disk, Static or DHCP IP)

Login and update the container `apt update; apt upgrade; apt install nginx git python3-venv`

Add the file `nano /etc/nginx/sites-enabled/plannertool`
```
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Remove the symlink for default site `unlink /etc/nginx/sites-enabled/default` and relad nginx `systemctl reload nginx`.
Add a non-root user to run the service `adduser planner`. Set a password, then `su planner` and go to the user home directory.
Clone this git repository `git clone https://github.com/kpoppel/PlannerTool.git`.
Setup the environment and run the service
```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn planner:make_app --factory
```

If this works, proceed to setting up the tool to automatically update and start.  This step uses `scripts/systemd_runner.sh` and `scripts/plannertool.service`. Ensure the shell script is `chmod +x`

As root copy the `plannertool.service` to `/etc/systemd/system/`. Then reload and start it:
```
systemctl daemon-reload
systemctl enable plannertool
systemctl start plannertool
```

# First time use
Look at the example configuration files in `docs/example-*`. You can use these for a terminal only setup process.
You can also use the user interface for this:

1. Point your browser to the IP address http://<your server IP>/ (add :8000 if you are not using nginx proxy)
2. Complete the user onboarding and add your email and PAT in the configuration page.
3. Navigate to the http://<your server IP>/admin page. You will get a 404 error. This is expected.
4. On the server you will see `data/accounts/` and `data/accounts_admin/` . Copy your user account to the `accounts_admin/` directory.
5. Now you can access the admin interface.
6. From here add projects teams and users if you want. Self-signup was one of the design goals of this project to keep maintenance low.
   You can promote and delete users as well.

Then go break something. Nothing is written back to Azure unless a user decides to explicitly do so.

# Advanced configuration
If you are also using the SuccessFactors chrome addon and server backend, this tool can use data from that tool for calculating cost.

Configuring `database.yaml` location
-----------------------------------

You can override where the server loads the `database.yaml` file by adding
one of the following keys to `data/config/server_config.yml`:

- `database_path`: path to the YAML file (absolute or relative to `data/config`)

Examples:

Absolute path:
```
database_path: /etc/plannertool/teamdb/database.yaml
```

Relative to `data/config`:
```
database_path: ../shared-configs/database.yaml
```

If neither key is present the server will fall back to `data/config/database.yaml`.

The server will run a setup first time. If you need to run the setup again, either delete the `data/config/server_config.yml` file or run `python3 planner.py --setup`.


---

# Contributing to the project
This section is for contributors and those who wants to know how to use the tool from CLI.

# Testing

- Install code coverage tool
  `npm install --save-dev c8`
- Run the tests with coverage
  `npx c8 node scripts/run_js_tests.mjs`
- Run tests without coverage
  `node ./scripts/run_js_tests.mjs`

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


## Possible future work/ideas/features
- Feature: (undefined) ??Highlight places with 'points of interest'?? TBD. Ideas:
  - Places where dependency relation has start date later than successor start date
  - Capacity over-utilised (in graph now, could highlight cards of interest/filter those etc.)
- Feature: Make it possible to edit description in the UI
- Feature: Allow user side specification of projects so it is not server side
- Feature: Allow user side specification of teams so it is not server side
- Feature: Allow sharing and selecting which projects to load for a user (reducing load time a tiny amount)
- Feature (convenience) Export graph view data to Excel format.
- Feature(config): Allow user to select which area paths to show, and which teams to include.
  Store user selection with user profile and only return data relevant to the user.
  For mullti-department use: Further group teams and departments in teh server config and allow users to
  select whole departments or pick and choose
  Alternative: just deploy a server per department - this is much easier and more performant anyway.
- feature(scenarios): Visualise difference from a saved scenario to the current Azure state
  To do this a scenario must save the baseline it was made from.
  Mark card which have no overrides but differs from the current baseline when an option is selected. An unmovable shadow card under the cards perhaps.
  Add a menu option on scenarios to sync to current baseline (copy Azure stato into scenario). Shadow cards should disappear.
  Overrides stay as-is (no shadow card).  Reset resets override to saved scenario (potentially getting a shadow)
- feature: Cost estimation
  Using the capacity estimation calculate this:
  1. (/) Cost per feature/Epic
  2. Sum of cost per project (unfinished work)
  3. Sum of cost this fiscal year (configurable WSA 1/10-31/9)
  4. Sum of cost all time
- bug/feature: Show Unplanned depends on Show Unassigned also being selected.
