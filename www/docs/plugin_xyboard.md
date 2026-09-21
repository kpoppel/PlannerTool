# Tool - XY Board

XY Board plots features in a 2D matrix using any two fields you choose, for example State against Priority, or Team against Severity. Each cell holds the features matching that combination, which makes it easy to spot distribution and clusters that are hard to see on a timeline.

## Opening the tool

Open the Top Menu → Tools → "XY Board". The view replaces the timeline board full-screen; close it (or select it again in the Tools menu) to return to the timeline.

## Controls

- X Axis / Y Axis: choose which field defines the columns and rows — options include State, Type, Iteration, Priority, Severity, Product Type, Tags and Area Path, plus any custom fields present on your features.
- Task Types: filter which work item types are included.
- Card Details: choose which extra fields are shown as badges on each card (for example Priority or Tags).

Column and row headers stay pinned (sticky) while you scroll so you always know which axis value you are looking at.

## Working with cards

- Click a card to select it and open the [Details Panel](details.md).
- A feature with a multi-valued field (such as Tags) appears once per matching value, so it can show up in more than one cell.
- Cards cannot be dragged on this board — use the timeline or Details Panel to change dates or fields.

## Persistence

Your axis choices, task type filter and detail field selection are remembered per view, so reopening XY Board restores your last configuration.
