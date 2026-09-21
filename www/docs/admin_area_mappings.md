# Admin - Area Mappings

Area Mappings shows, for each Azure DevOps area path, which delivery plans are associated with it, and lets you choose which of those plans should be considered by PlannerTool (for example for [Plan Markers](plugin_markers.md) and iteration-aware planning).

## Layout

- Mappings are grouped by Azure project, with one card per area path.
- Each card shows the area path, when it was last refreshed, how many iterations and plans were found, and a checkbox list of the plans available for that area.

## Refreshing

- Click the refresh control on a single card to re-fetch that area path's plans and iterations from Azure DevOps.
- Use "Refresh All" to re-sync every area path at once.
- Toggle individual plan checkboxes to include or exclude a plan for that area path, then Save.

## Notes

- Refreshing requires a valid Personal Access Token with access to the relevant Azure DevOps projects.
- A raw JSON view is available for bulk review or editing of the underlying mapping data.
- If plans appear missing or out of date, refresh the relevant area first before assuming a configuration problem elsewhere.
