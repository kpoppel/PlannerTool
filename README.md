# Getting started - development

- Clone this git repository `git clone https://github.com/kpoppel/PlannerTool.git`.
- Install Python 3.13 or later
- Install nvm (node version manager)
  check out the latest release here: https://github.com/nvm-sh/nvm/releases
  ```
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  ```
- Install npm and node
  `nvm install --lts`
- Install the modules used for development
  `npm install`
- Install requirements for virtual environments
  `sudo apt install python3-venv`
- Create the virtual environment for the project
  `python3 -m venv .venv`
- Activate the environment (do this every time in the console window where you need to run the application)
  `source .venv/bin/activate`
  **Tip:** To leave the venv, type the command `deactivate` (but why would you?)
- Install project requirements
  `pip install -r requirements.txt`
  `pip install -r requirements-dev.txt`

### Development (unbundled)

The server can be run unbundled, which is great for development. The browser cache needs to
be cleared after all updates of the Javascript code, so disable browser cache in the browser
development mode.

Run the server:
```bash
uvicorn planner:make_app --factory --reload --port 8000 2>&1 |tee logfile.log
```
**Tip:** you can leave out the pipe to the logfile if you don not want a file log.
**Tip:** Leave out --port and --reload and the tee to logfile if you don't need this.

Use the application by browsing to `http://localhost:8000`

### Production (bundled)

The server can be run bundled too. This ensures the browser cache is invalidated because filenames
change with updated content.  The price is the extra step building the bundle.

Run the server:
```bash
# If the Lit bundle needs to updated (should not be the case)
npm run build:vendor

# Build first
npm run build

# Run production server
uvicorn planner:make_dist_app --factory --port 8000 --reload 2>&1 |tee logfile.log
```
**Tip:** you can leave out the pipe to the logfile if you don not want a file log.
**Tip:** Leave out --port and --reload and the tee to logfile if you don't need this.

Use the application by browsing to `http://localhost:8000`

# Getting started - deployment

**Tip:**
- Shortcut setting up the first account:
  ```
  curl -i -X POST http://localhost:8001/admin/v1/setup -H "Content-Type: application/json" -d '{"email":"user@example.com","pat":"SOME_PAT"}'
  ```


Checkout the `docs/DEPLOYMENT.md` file.

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

# Testing

See `docs/TESTING.md` for details.

# Contributing to the project

See `CONTRIBUTING.md` for details.

# Ideas?

See `docs/IDEAS.md` for ideas.