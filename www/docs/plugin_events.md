# Tool - Plan Events

Plan Events lets you place your own custom milestone markers on the timeline, such as "Sprint End", "Launch Window" or "Review Date".
These events are independent of Azure DevOps Delivery Plans (see [Tool - Plan Markers](plugin_markers.md) for those) — they are your own annotations tied to a plan.

## Opening the tool

Open the Top Menu → Tools → "Plan Events". A floating "Plan Events" panel appears, listing every plan currently selected and any events already defined for it.

## Adding and editing events

- Expand a plan in the panel and use the "+" control to add a new event.
- Fill in a date (and optionally an end date for multi-day events), a title, and a category to help group related events.
- Confirm with the save control, or discard with cancel.
- Existing events can be opened for editing, or removed, from the same list.

## On the timeline

- Events appear as tagged markers on the timeline at their scheduled date, coloured by the owning plan.
- Use the refresh control in the panel if events do not appear to be up to date after an edit made elsewhere.

## Scope and persistence

- Events are stored per scenario, so different scenarios can carry a different set of milestones.
- Events are local to PlannerTool — they are not written back to Azure DevOps.
