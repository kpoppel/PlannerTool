# Server Deployment

Define your instances and optional shared auth service in `instances.yml`, then run
`python scripts/deploy.py --apply --start`. The
[operator guide](docs/DEPLOYMENT.md#shared-auth-service) covers the standard shared
Compose stack, configuration ownership, protected state and the current mock-upstream
limitations. Select each instance's backend in Admin > Data Sources.

# Getting started - development

- Clone this git repository `git clone https://github.com/kpoppel/PlannerTool.git`.
- Install Python 3.13 or later (with venv support, e.g. `sudo apt install python3-venv`)
- Install Node.js 20 or later, e.g. via nvm (see below)
- Run `scripts/setup-dev.sh`. It creates `.venv`, installs Python and Node dependencies, the
  Playwright browser and git hooks, and installs `.mcp.json` plus gitignored `.vscode/` and
  `.github/` files from `scripts/dev-config/` (local edits are kept and reported). Re-run it after pulling
  changes: steps whose inputs are unchanged are skipped (`--force` re-runs everything).

Manual setup, step by step:

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

Follow the instructions in `docs/DEPLOYMENT.md` for running the application.
The standard development workflow is `./scripts/run_dev.sh` (Vite dev server + uvicorn backend).

Database initialization and upgrades run inside server startup before HTTP is
available. Set `DATA_DIR` to the installation root when using a custom location.
Before first adoption, stop all old server processes and take an independent full
backup if older-binary recovery is needed. Successful upgrades retain no predecessor.
See [docs/MIGRATIONS.md](docs/MIGRATIONS.md) for supported legacy admission and
`python planner.py database status`, `retry`, `restore`, and `prune` operations.

# Git hooks

Install repository git hooks once after cloning:

`bash scripts/setup-git-hooks.sh`

The pre-commit hook blocks new staged JS/test additions that introduce `?.`, `??`, `Array.isArray(`, or fallback-style `||` defaults (for example `value || ''`, `value || []`, `value || null`).

Only bypass after explicit user confirmation that the construction is truly necessary for correctness:

`ALLOW_STRICT_CONTRACT_PATTERNS=1 git commit ...`

# First time use

The application will load into first-time user setup if it is a fresh installation.
If you don't want to go through the first time user setup UI, do it from the CLI directly:
  ```
  curl -i -X POST http://localhost:8001/admin/v1/setup -H "Content-Type: application/json" -d '{"email":"user@example.com","pat":"SOME_PAT"}'
  ```

Otherwise just follow the UI setup.

1. Point your browser to the IP address http://<your server IP>/ (add :8000 or :5173 if using one of the development deployment methods)
2. Complete the user onboarding and add your email and PAT in the configuration page.
3. Now you can access the admin interface.
4. From here add projects teams and users if you want. Self-signup was one of the design goals of this project to keep maintenance low.
   You can promote and delete users as well.

Then go break something. Nothing is written back to Azure unless a user decides to explicitly do so.

# Testing

See `docs/TESTING.md` for details.

# Contributing to the project

See `CONTRIBUTING.md` for details.

# Ideas?

See `docs/IDEAS.md` for ideas.
