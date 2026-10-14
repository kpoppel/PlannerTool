# Admin - Teams

The Teams screen defines the team structure used throughout PlannerTool: team names, optional parent teams, and other team attributes referenced by capacity and cost calculations.

## Editing teams

Teams are edited with a schema-driven form: fields are generated automatically from the configuration schema, so the exact set of attributes available (team id, name, parent team, description, and similar fields) reflects your installation's schema version.

- Use the form view for guided editing with labelled fields.
- Switch to the raw JSON view for bulk edits or to copy configuration between environments.
- Click Save to persist changes, or Reload to discard local edits and re-fetch the current server value.

## Available project hours

Define each team's available hours as **project hours**, not total working hours. Project hours are the time available for delivering project work and form the capacity against which work is allocated.

Exclude time unavailable for project delivery, such as holidays, absences and company administration, when determining available project hours. The remaining hours up to total working hours are not specified in PlannerTool; the tool does not track or deduct them separately.

Maintenance, internal projects and other activities that consume this project capacity must instead be planned as work with explicit start and end dates and team allocations. There is no implicit buffer for them. Agree on this capacity basis with Product Owners and Project Managers before reviewing allocation graphs. See [Planning principles](best_practices.md#planning-principles).

## Team hierarchy

Teams can reference a parent team, letting you model reporting or rollup structures (for example sub-teams under a larger delivery team). This hierarchy is used elsewhere in the tool, for example in capacity graphs and cost breakdowns.

## Related screens

- Assign people to teams in [Admin - People](admin_people.md).
- Configure cost rates per team in [Admin - Cost Configuration](admin_cost_config.md).
- After changing teams, existing scenario overrides that mention removed teams may need review in the main application.
