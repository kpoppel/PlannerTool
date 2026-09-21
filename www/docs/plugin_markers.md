# Tool - Plan Markers

Plan Markers shows milestone markers from Azure DevOps Delivery Plans on the timeline, so teams that already track milestones there (e.g. "M1: Planning", "M2: Development", "M3: Release") can see them alongside PlannerTool's schedule.

## Requirements

- Your Azure DevOps organisation must have Delivery Plans configured with markers.
- You need the "Manage Delivery Plans" permission in Azure DevOps to read them (see [Getting Started](getting_started.md) for related permission notes).

## Opening the tool

Open the Top Menu → Tools → "Plan Markers". A floating "Plan Markers" panel opens and fetches marker data for your currently selected projects and teams.

## Using the panel

- A legend lists every delivery plan contributing markers, with a colour swatch and a count of markers from that plan.
- Click a plan's name in the legend to hide or show its markers on the timeline; hidden plans are shown greyed out in the legend.
- Use the refresh control to re-fetch markers from Azure DevOps, for example after a plan owner updates milestone dates.
- Hover a marker on the timeline to see the owning plan and the milestone label.

## Scope

- Markers respect your current Project and Team selection — only markers relevant to the current scope are shown.
- This is a read-only view: PlannerTool does not write marker changes back to Azure DevOps.

## Troubleshooting

If markers do not refresh, confirm your Personal Access Token still has "Manage Delivery Plans" permission and has not expired.
