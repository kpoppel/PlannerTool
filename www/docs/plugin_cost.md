# Cost Estimates & Teams (deprecated)

PlannerTool provides cost estimation features and a teams summary API to help evaluate resource and external costs.

Cost estimation
- Use the Export/Cost tools from the Top Menu or plugins to run cost calculations for the active scenario.
- Cost calculations use per-item `capacity` allocations and the configured `cost_config` on the server.

Teams endpoint
- The UI uses an internal `/api/cost/teams` endpoint to retrieve team membership, internal/external flags, and hourly rates.
- Team totals are built from the `people` configuration and `cost_config` (working hours and external rates).

Scenario overrides
- When estimating cost for a scenario, PlannerTool applies any scenario overrides (start/end/capacity) before computing costs.

Notes
- Admins can configure `cost_config` (working hours, internal/external rates) via the Admin UI.
- If cost data seems incorrect, check the `people` configuration and `cost_config` values on the server.
