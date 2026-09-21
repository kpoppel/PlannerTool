# Admin - Data Sources

Data Sources is the central place to choose where each type of data comes from, and how long it is cached before being re-fetched.

## Layout

A table lists every data domain as a row:

- Read-only rows (always backed by PlannerTool's own storage): Scenarios, Views, People, Teams.
- Configurable rows: Work Items, History, Iterations, Markers, Plans/Boards, Tasks, Events, Groups.

For each configurable row you choose a backend and a cache time-to-live (TTL) in minutes.

## Backend types

- ADO Live: fetch real data from your Azure DevOps organisation. Requires an organisation URL and a Personal Access Token.
- ADO Mock Fixture: serve fixed sample data from a fixture file — useful for demos or testing without touching a real Azure DevOps organisation.
- ADO Mock Generator: generate synthetic sample data on the fly.
- Static: serve a static, manually curated backend configuration.

Selecting a backend reveals the matching sub-form (for example the Organisation URL and PAT fields for ADO Live).

## Saving changes

- Click Save to persist the configuration for a domain.
- Some changes require a restart of the server process to fully take effect — a warning banner appears when that is the case.

## Notes

- Changing the backend for Work Items, History or Iterations effectively switches your whole installation between a live Azure DevOps connection and a mock/demo dataset — do this deliberately, not by accident.
- After changing a backend or TTL, consider using [Admin - Cache Invalidation](admin_cache_invalidation.md) to force a clean re-fetch rather than waiting for the previous cache entry to expire.
