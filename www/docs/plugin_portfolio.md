# Tool - Portfolio Board

Portfolio Board is a Kanban-style view of the selected work: teams as rows, states as columns and tasks as cards in each cell. It gives a quick read of "what is where" across teams, independent of the timeline layout.

![Portfolio Board](img/tool_portfolio.png)

## Opening the tool

Open **Tools → Portfolio Board**. The board area is replaced by the "Portfolio Planning Board"; the top menu and Sidebar stay available. Close it with **Close** or by selecting it again in the Tools menu.

## Layout

- **Toolbar**: shows "No scenario selected" while Baseline is active (the board is then read-only) and the number of pending changes in a scenario.
- **Timeline overview** (collapsible): bars for the same tasks on a compact timeline.
- **Board** (collapsible): the header shows the number of teams and states, and each plan's number of contributing teams. Rows are the teams selected in the Sidebar's Team Drill-down; columns are the workflow states with task counts. Cards show ID, title, owning plan, the team's allocation, dates and tags. "Multi-team" marks tasks allocated to several teams.
- **Tasks** (collapsible): a table of tasks matching the Sidebar filters, with ID, title, team allocations, plan, start, end, state and tags. Allocated and unallocated tasks are included according to the existing Sidebar toggles.

## Working with cards

- Click a card or a task row to select the task and open the [Details Panel](details.md).
- In an editable scenario, drag a card to another state column in the same team row to change its state. The change goes into the active scenario.

## Editing allocations in the task table

The table shows a column for each team allocated to its visible tasks. Use **+** to add a column from the available team pool, then enter allocations for the tasks that team should work on. Adding a column alone does not assign the team to any task.

Allocation cells use the unit selected in Configuration: percent or whole man-days. Type a value and press Enter or leave the cell to apply it. Scroll over a cell to adjust by one percentage point or one man-day; zero removes that team's assignment. Escape cancels an uncommitted typed value. Team columns stay compact and adjacent, with horizontal scrolling when needed. Edits go into the active scenario without changing Baseline.

Cells are disabled in read-only scenarios and for teams unavailable to the task. Man-day editing also requires loaded, nonzero team staffing and a schedule with working days. Values cannot exceed the team's staffed working-day capacity (100%).

## Editing dates in the task table

Edit Start or End directly in the row using the date fields. Date changes use the same scheduling rules as the Details Panel, including child-date constraints. Percent mode preserves allocation percentages; man-day mode preserves effort. If preserving effort would exceed capacity, the edit is rejected and the previous date remains. Date fields are disabled in read-only scenarios.

## Scope

The board follows the selected plans, Scope, the Sidebar's task filters and team selection.
