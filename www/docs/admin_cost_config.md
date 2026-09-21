# Admin - Cost Configuration

The Cost screen configures the parameters used by the [Cost Analysis tool](plugin_cost.md), such as rates and capacity assumptions used to turn allocations into cost and hours figures.

## Configuration tab

Edit cost parameters with the same schema-driven form and raw JSON pattern used elsewhere in the Admin UI. Typical fields include team rates, cost units, and forecasting parameters — the exact set depends on your installation's schema. Save persists changes; Reload discards local edits.

## Inspection tab

The Inspection tab gives a read-only summary of current cost calculations and team capacity, useful for sanity-checking configuration changes before users rely on them in the Cost Analysis tool.

## Related

- See [Admin - Teams](admin_teams.md) and [Admin - People](admin_people.md) for the underlying team and people data cost calculations build on.
- See [Tool - Cost Estimates & Teams](plugin_cost.md) for how end users read the resulting reports.
