---
applyTo: "**"
---

# Workspace Copilot / Agent Instructions (bootstrap)

This file bootstraps guidance for AI assistants and contributor workflows. Keep this short and actionable — link to detailed docs for long policies.

---
applyTo: "**"
---

# Quick purpose
- Provide a minimal, discoverable set of rules and commands so automation and humans can work consistently across the repository.
- For strict guidance on fail-fast contracts and where robustness guards are allowed, follow `.github/strict-fail-fast-contracts.instructions.md` for all `www/js` edits.

## Workflow (for an agent)
- Make a plan for the edits needed to accomplish the task, including which files to modify and how.
- Use TDD and and write a test first when implementing new features or fixing bugs.
- Prefer the registered `plannertool-tests` MCP server for automated pytest, Vitest, Playwright, and
	frontend build checks; use CLI execution only when MCP is unavailable or a required option is unsupported. Start with narrow
	targets, launch independent checks concurrently with `wait=false`, poll each by `run_id`, and request
	failure/log details only when the summary is insufficient.
	For Playwright MCP runs, set `project` to a configured project such as `chromium`; it maps to `--project`.
	Test process output stays in `.test-runs/` logs.
- Prefer small, focused edits and create a PR with a clear description.
- Create comments in the code when making non-obvious changes or when the reasoning may not be clear to future maintainers.
- Do not remove comments without understanding their purpose; if a comment is outdated, update it rather than deleting it.
- When in doubt, ask for a clarifying human instruction before making large architectural changes.
- Update the CHANGELOG.md with a one-line summary of the change

## Key commands (environment & tests)
- Python: activate the Python venv

```
source .venv/bin/activate
```

Agents should use the MCP `run_tests` tool for routine test runs. Set `wait=false` to run independent
checks concurrently and poll `get_status` with each returned `run_id`; use `list_runs` to recover IDs, and query
`get_failures` or `get_log` by ID when more detail is needed. The CLI examples below remain available
for humans and for test options the MCP runner does not expose.

- Run server (development)

Run the server on port 8001:
```
uvicorn planner:make_app --factory --reload --port 8001 2>&1 |tee logfile.log
```

Logfile outputs are available in the file `logfile.log` for review and debugging.

- Run Python tests

```
pytest
```

- JavaScript tests / Vitest (from `package.json`)

```
npm test
```

- Live server checks require an already enrolled private cookie jar. Unit/E2E
	tests use isolated fixtures and must not enroll accounts in the active `data/`.
	Renew a session without consuming the account key:

```
curl -s -b "$HOME/planner-cookies.txt" -c "$HOME/planner-cookies.txt" \
	-X POST -H "Accept: application/json" http://localhost:8001/api/session
```
Use that cookie jar for authenticated requests; email-only sessions and
X-Session-Id are unsupported. Initial CLI enrollment requires the user's explicit
action and private key handoff; see `scripts/README.md`. Never request keys in
chat or log cookies, account keys, or PATs.

```
curl -s -b "$HOME/planner-cookies.txt" -H "Accept: application/json" http://localhost:8001/api/health
```

## What to include in an automated change
- Purpose: 1–2 sentence reason for the change.
- Scope: files modified and why.
- Tests: unit or integration tests added or updated.
- Backward compatibility notes if applicable.

## Project conventions (preserve below)
- Never create fallback code paths. Expect all changes to always roll forward.
- Avoid creating conservative "safe" code paths that add complexity. Instead, make the change as needed and rely on tests and monitoring to catch issues.
- When fixing a bug, first create a test which reproduces the bug, then implement the fix. This ensures the bug is properly captured and prevents regressions.

# Project general coding standards

## Naming Conventions
- Use PascalCase for component names, interfaces, and type aliases
- Use camelCase for variables, functions, and methods
- Prefix private class members with underscore (_)
- Use ALL_CAPS for constants

## Error Handling
- Use try/catch blocks for async operations
- Implement proper error boundaries in React components
- Always log errors with contextual information
