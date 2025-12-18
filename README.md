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

## Run a sessinon from CLI
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


# WIP - Planner REST calls:

Create a session
  export SESSION_ID=$(curl -s -X POST -H "Content-Type: application/json" -d '{"email":"user@example.com"}' http://localhost:8000/api/session | jq -r .sessionId)

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
  # Use the cost estimation endpoint
  curl -s -H "X-Session-Id: $SESSION_ID" http://localhost:8000/api/cost | jq

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
- Team backlogs. Can they be bundled up?  Not without consistent use of team assignments.
  Teams and projects in Azure is a floating thing. It is all tasks with an area path associated. Only the area path
  sets projects and teams apart. In our context we should only put "Epics" in projects, and only "Features" (and below") in teams.
  - Require clean up in Azure to streamline this.
  - In the backend and frontend refactor so that "projects" are those with some id prefix (like 'project-') and teams with 
    another (like "team-"). This is only to display them in different places. All other handling is the same.
    However it could also just be simplified to "Projects" with each team just also being a project, like it is now.
    A team can still participate on multiple Epics but could also more rarely participate on another team's Features.
- feat:Add filter to sort away tasks without start/target dates.
  Reasoning: The iteration view in Azure is used in a way that items without iteration and start/target dates are not shown in the delivery plan page. Those without dates are not ready for primetime.
  TODO: Add field to the data signaling the data was originally without date, or don't add it from the server side and add it in the UI.
- feat: Improve filter for task state to be additive not exclusive
- feat: Make a modal to configure team capacity spend.
  Iteration 1: Just output the text to put in Azure Devops manually
  Iteration 2: Make the change when syncing to Azure
- feature: Cost estimation
  Based on the calendar people ledger we know the size of our teams and how many externals each team has.
  Need to enrich the externals with their hourly cost
  Need to enrich the data with worked hours: permanent: 116 h/month (could be different per site), externals 160h/month
  Using the capacity estimation calculate this:
  1. Cost per feature/Epic
  2. Sum of cost per project (unfinished work)
  3. Sum of cost this fiscal year (configurable WSA 1/10-31/9)
  4. Sum of cost all time
  First iteration: Use the team yaml file to avoid extra data orouces. Use serverside configuration in a separate configuration file for working 

Next:

Later:
- Feature: Make it possible to edit team load in the UI
- Feature: Make it possible to edit description in the UI
- Feature (convenience): Make a 'shrink-wrap' feature to pull in an Epic to fir the content (change start and end date)
- Feature (convenience): Make it possible to drag deft side of cards too
- Feature: Allow user side specification of projects so it is not server side
- Feature: Allow user side specification of teams so it is not server side
- Feature: Allow sharing and selecting which projects to load for a user (reducing load time)
- Feature (convenience) Export mountain view data to Excel format.

Solved:
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
