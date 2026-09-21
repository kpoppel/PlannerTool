# Tool - Portfolio Board

Portfolio Board is a full-screen, Kanban-style view of your plan: teams as rows, feature states as columns, and features as cards inside each cell. It is useful for a quick read of "what is where" across teams, independent of the timeline layout.

## Opening the tool

Open the Top Menu → Tools → "Portfolio Board". The view replaces the timeline board full-screen; close it (or select it again in the Tools menu) to return to the timeline.

## Reading the board

- Rows are teams; columns are the feature states configured for your project (see [Best Practices](best_practices.md) for state conventions).
- Cards show the feature title, a project colour indicator, and the team's allocation for that feature.
- An "Unallocated" section lists features that have not yet been assigned to any team; expand it to see and assign them.
- An optional Timeline section can be expanded below the board to show Gantt-style bars for the same features, aligned to the same team rows.

## Moving work

- Drag a card from one state column to another, within the same team row, to change its state. The change is saved immediately to the active scenario.
- The board shows the active scenario name and how many pending (unsaved) changes exist.
- Click a card to select it and open the [Details Panel](details.md) for full editing.

## Scope

The board respects your current View, Team and Project selection, and the task type and state filters set in the Sidebar.
