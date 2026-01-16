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
curl -X POST -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/config
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

# Installing the backend in Proxmox LXC

Use a template, here we use Debian 13.x as the base. If you are running on Proxmox 8, use this template:
`https://cdn.gyptazy.com/proxmox/lxc_container/debian-13-standard_13.0-0_amd64.tar.zst` Download this as a container teamplate.
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
Clone the git repository `git clone https://github.com/kpoppel/PlannerTool.git`.
Setup the environment and run the service
```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn planner:app
```

If this works, proceed to setting up the tool to automatically update and start.  This step uses `scripts/systemd_runner.sh` and `scripts/plannertool.service`. Ensure the shell script is `chmod +x`

As root copy the `plannertool.service` to `/etc/systemd/system/`. Then reload and start it:
```
systemctl daemon-reload
systemctl enable plannertool
systemctl start plannertool
```

# Known issues and future features
- feature(scenarios): Visualise difference from a saved scenario to the current Azure state
  To do this a scenario must save the baseline it was made from.
  Mark card which have no overrides but differs from the current baseline when an option is selected. An unmovable shadow card under the cards perhaps.
  Add a menu option on scenarios to sync to current baseline (copy Azure stato into scenario). Shadow cards should disappear.
  Overrides stay as-is (no shadow card).  Reset resets override to saved scenario (potentially getting a shadow)
- feature: Add First use journey to help the user get a PAT and configure the app. Automatic reload after PAT is entered.
- feature (stretch): Add introduction tour for first time users (or via configuration option in the config modal).
  Overlay with "speech bubbles explaining the various parts of the app)
- feature: Cost estimation
  Using the capacity estimation calculate this:
  1. (/) Cost per feature/Epic
  2. Sum of cost per project (unfinished work)
  3. Sum of cost this fiscal year (configurable WSA 1/10-31/9)
  4. Sum of cost all time
- bug: Show Unplanned depends on Show Unassigned also being selected.
Next:
- feature: Add version as part of te /api/health endpoint to show what version the server is running.

Later:
- (undefined) ??Highlight places with 'points of interest'?? TBD. Ideas:
  - Places where dependency relation has start date later than successor start date
  - Capacity over-utilised (done)
- Feature: Make it possible to edit description in the UI
- Feature (convenience): Make a 'shrink-wrap' feature to pull in an Epic to fir the content (change start and end date)
- Feature (convenience): Make it possible to drag deft side of cards too
- Feature: Allow user side specification of projects so it is not server side
- Feature: Allow user side specification of teams so it is not server side
- Feature: Allow sharing and selecting which projects to load for a user (reducing load time)
- Feature (convenience) Export mountain view data to Excel format.
- feature(config): Allow user to select which area paths to show, and which teams to include.
  Store user selection with user profile and only return data relevant to the user.
  For mullti-department use: Further group teams and departments in teh server config and allow users to
  select whole departments or pick and choose
  Alternative: just deploy a server per department - this might be more performant anyway.


Solved:
- (/) feat: Enable flagging cost smells.
- (/) Team backlogs. Can they be bundled up?  Not without consistent use of team assignments.
  Teams and projects in Azure is a floating thing. It is all tasks with an area path associated. Only the area path
  sets projects and teams apart. In our context we should only put "Epics" in projects, and only "Features" (and below") in teams.
  - Require clean up in Azure to streamline this.
  - In the backend and frontend refactor so that "projects" are those with some id prefix (like 'project-') and teams with 
    another (like "team-"). This is only to display them in different places. All other handling is the same.
    However it could also just be simplified to "Projects" with each team just also being a project, like it is now.
    A team can still participate on multiple Epics but could also more rarely participate on another team's Features.
  -> Decision: Section renamed to "planning" there is no difference between project and team. User must use the filters and the tool
     remains agnostic to area paths. No new semantics introduced this way.
- (/) change(sidebar): Rename "Teams" to "Allocations", and "Projects" to "Planning" (line 487, 471)
- (/) bug: Export of PNG for many visible items fails and is now followed by a more informative message.
- (/) feature: add a way to export a png of the visible section of the timeline.
- (/) feature: Move png export to 'export' plugin to export png. Default to visible timeline. Allow selecting date range.
- (/) feature: extend 'export' plugin with export in other formats, like CSV: id, title, capacity, cost estimate
- (/) feature: extend 'export' plugin with tools to add notes and lines before export (not persisted)
- (/) feature: Add tool overlay plugin to add notes to the timeline and cards? SVG overlay like the dependency lines? (persisted)
- (/) Use of Icons: Use the same icons everywhere - perhaps material icons?
- (/) Add for plugins an "exclusive" or "single" property. When false, the plugin can be opened alongside other plugins.
  When false it will close all other plugins when opening. And when opening anothe plugin it will be closed itself.
- (/) bug: The side panel must persist settings for teams and projects in addition to open closed sections.
- (/) feature: Add a 3-month view to timeline scale. Left border is start of month. If window is resized view will scale.
- (/) bug: Changing scenarios does not refresh cost calculation data (this worked before)
  response: {"detail":"'float' object is not iterable"}
  GET works.  Should simplify to use POST for any scenario including the baseline.
- (/) bug: After opening the Cost plugin, changing scenarios shows the spinner modal with the text "Loading Cost Data".  Cost data is loaded
  for each scenario change from this point onwards. The plugin must unregister from the scenario change event when closed.
- (/) bug: When assigning capacity to a feature and moving or resizing it, the capacity override is lost. It does not matter if the feature
  already has a capacity allocation or not.
- (/) bug: The team selection popover in the details panel shows below the <main> element. Redesigned this part.
- (/) feat:Add filter to sort away tasks without start/target dates.
  Reasoning: The iteration view in Azure is used in a way that items without iteration and start/target dates are not shown in the delivery plan page. Those without dates are not ready for primetime.
  TODO: Add field to the data signaling the data was originally without date, or don't add it from the server side and add it in the UI.
- (/) Feature: Make it possible to edit team load in the UI
  - feat: Make a modal to configure team capacity spend.
    Iteration 1: Just output the text to put in Azure Devops manually
    Iteration 2: Make the change when syncing to Azure
- (/) feature: Cost estimation - first iteration
      Cost per Epic/Feature is estimated on tasks where capacity estimation is present.
      The estimation is opinionated (via feature flag) so that Epic estimates are ignored
      if it has children assuming a breakdown is more precise even if there are gaps in date spans.
      Based on the calendar people ledger we know the size of our teams and how many externals each team has.
      Need to enrich the externals with their hourly cost
      Need to enrich the data with worked hours: permanent: 116 h/month (could be different per site), externals 160h/month      
      First iteration: Use the team yaml file to avoid extra data sources. Use serverside configuration in a separate configuration file for working 
- (/) feat: Improve filter for task state to be additive not exclusive
- (/) Feature: Make the sidebar more nice to look at.
- (/) Feature: Page with mountain view large on it's own page with labels.
- (/) Feature count: 3 digits
- (/) Need to be able to fit all in the sidebar. Collapse or reduce font size?
- (/) Fix Azure link to point to UI
- (/) Bug: Changing end date of Epic and dragging it moved end date back to original date of latest child date? Not using the override date info on the Epic, and not using the override date of children?
  - The problem is: Calculation is made on the baseline data. Before determining correct dates the overrides needs to be applied
  - Solution: find all children in baseline, replace entries with override entries. Then calculate latest date.
- (/) Feature: If there is a dependency, show this on the board. (how to determine dependency? Data from Azure?)
  - Determine link type to use: Related, Predecessor, or Successor (or all?)
  - "Related" is simple at it does not imply a direction. The other two requires the maintainer to be vigilant.
  - Details panel: Add Parents and children and pre/suc/rel links.
- (/) Bug: Team load calculation: when a team is 100% loaded, the graph should display 100% too when looking at the teams.
  - Organisation load is good as it is.
  - Perhaps switch to a line graph/piecewise linear representation when in team load mode.
- (/) Feature: If there are children with load data, use this data instead of the Epic. (empty spaces go to zero)
  - Feature: If there are children propagate children data? May be really difficult as load will vary over time.
  - Perhaps just turn off the Epic estimate in that case.
  - What if the epics are shown alone? Load graph should still display propagated load as this is more accurate.
  - If there are no children use the Epic estimates.
  - NOTE: This is now a const variable to do either of these. Default is to ignore Epic if it has children.
- (/) Finish scenario save/load per user
- (/) doc: Add to README information about the workflow. Document the use the task states actively:
  - New: Unplanned work
  - Defined: Planned work, described adequately for further breakdown
  - Active: Work in progress, developers assigned, time spent
  - Resolved: Work completed, reviewed, demo, delivery processing
  - Closed (not fetched): Task completed.
- (/) Bug: state.js line 229 hangs the browser. (Reason: an event handler was created again and again)
- (/) doc: Way of Working: How to organise data to get capacity graphs correctly displayed:
  - Projects only contain Epics.
  - Teams Do not have any Epics. They have Features (maybe someday Enabler type) and below.
  - Project capacity spend is calculated from all Features which are children to those Epics.
  - Team capacity spend is calculated from all Features where the team is mentioned.
  - Right now:
    - Projects and teams are more or less coincident.
    - Team load should be able to calculate regardless.
    - Project load more difficult.
