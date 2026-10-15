# Admin - Projects

The Projects screen maps Azure DevOps area paths to the plans that PlannerTool users can select in the main application.

## Fields per project

- Name: the display name shown to users.
- Area path: the Azure DevOps area path this project reads work items from.
- Task types: the work item types included for this project.
- Include states: every work item state to track for this project.
- Display states: the subset of "Include states" actually shown in the UI (useful to hide terminal or rarely used states without losing their data).
- Iteration set: optionally link the project to a named iteration set (see [Admin - Iterations](admin_iterations.md)) to enable iteration-aware planning.

## Adding a project

1. Click "Add Project".
2. Either type the area path directly, or open "Browse Azure Projects" to pick a live Azure DevOps project and browse its area paths — selecting one pre-fills the form and suggests available task types and states from Azure metadata.
3. Choose the task types and states this project should track, and a display subset if needed.
4. Optionally link an iteration set.
5. Save.

## Editing and removing

- Click Edit on a project row to change its fields, then Save; the row is saved immediately.
- Click Archive to keep a project configured but remove it from the project choices and data loading. Archived projects are hidden by default; use Show archived to restore one.
- New projects can be archived before saving if they are being prepared for later use.
- Project archive/restore, deletion, reordering, allocation defaults, and container hierarchy changes are saved automatically. Raw JSON changes are saved with Save JSON.
- Click Delete to remove a project; confirm when prompted. Removing a project only removes it from PlannerTool's configuration — it does not change anything in Azure DevOps.

## Notes

- Browsing Azure projects and area paths requires a valid Personal Access Token configured for the server (see [Admin - Data Sources](admin_data_sources.md)).
- If a project's data looks stale after this kind of change, use [Admin - Cache Invalidation](admin_cache_invalidation.md).
