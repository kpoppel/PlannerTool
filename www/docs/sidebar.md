# Task List, Teams, Hierarchy & Task Filters

The frozen task column replaces the Sidebar. **Teams**, **Hierarchy** and **Task Filters** are top-menu popovers. Plan selection, scenarios, views and tools remain in the [Top Menu](topmenu.md).

## Task List

- Task and group labels follow the board's rows, folding, filtering and zoom. Horizontal scrolling keeps labels visible; vertical scrolling moves labels and cards together.
- Click a task title to open the shared Details Panel. Fold controls affect the same branches as card chevrons. The ancestry number has a full-path tooltip, without deeper tasks widening the column.
- Drag the column divider to resize it between 200 and 600 pixels. When the divider is focused, Left/Right changes width by 20 pixels; Home/End selects the limits. Escape cancels a pointer resize.
- Collapse the column to restore titles on normal cards. Compact cards always retain inline titles; Packed mode hides the column. Width and collapse state are captured by saved views.
- Search matches task IDs and titles, ignoring case, with ID matches first. Enter or the arrow buttons navigates through matches. Search does not filter tasks, change Scope, or unfold branches; only currently eligible, unfolded tasks are searched, including rows outside the virtualized viewport.

## Team Drill-down

- Open **Teams** in the top menu.
- Lists only teams explicitly allocated to tasks in the selected plans and enabled Scope. The list updates as plan selection or Scope changes.
- Each team row shows a color dot (click to open the color popover), the team name, and counts for the two highest-ranking nonempty task types in the configured hierarchy. When more types have counts, expand **Counts** to see the full table. Types with no counts across the listed teams are omitted; individual zero cells are blank.
- Counts show the number of tasks explicitly allocated to that team anywhere in the loaded data, including active scenario changes. Each task is counted once per allocated team, not by allocation percentage or by which plan the team belongs to. Tasks without a team allocation do not contribute to team counts.
- These counts are not limited to selected plans, enabled Scope, team focus, or task filters. They are an allocation overview, not the number of that team's tasks you should expect to find in the current display. The team list is scope-limited; its counts are not.
- Click a team row to select or deselect it for display. On the [Graph Area](graph.md), team selection changes visible team lines, not organisational weighting or allocation calculations.
- Use the "All" / "None" toggle above the list to quickly select or deselect every team at once.
- Task view below the list offers **Plan overview** (default), which keeps unallocated tasks in the selected plans, and **Team focus**, which shows only tasks allocated to selected teams plus their parent tasks for context. With no teams selected, Team focus shows no tasks.
- If the selected plan(s) have no teams assigned, the section shows a short message instead of an empty list.

## Task Hierarchy

Open **Hierarchy** and use **Fold one level** (`-`) and **Expand one level** (`+`) to change visible
task hierarchy depth one level at a time. **Fold all** and **Expand all** act on
every branch. Controls stop at the available limits and folding is unavailable
in Packed mode. The header shows `-` and `+` shortcut pills; Task view shows `V`.

## Task Filters

Open **Task Filters** to narrow down which tasks are displayed, independent of which plans and teams are selected. Tab moves between enabled options; Space or Enter toggles the focused option.

- Schedule (`p`): Planned / Unplanned.
- Allocation (`a`): Allocated / Unallocated.
- Hierarchy (`i`): Has Parent / No Parent.
- Relations (`r`): Has Links / No Links.
- State: dynamic list populated from the loaded features — click a state to toggle it, the colored dot matches its configured state color.
- Task Types: dynamic list (Epic, Feature, etc.), ordered per the task type hierarchy configured by your administrator.

A filter option is greyed out and disabled when it is "not relevant in current tool context" (for example while a full-screen tool such as Portfolio Board or XY Board is active).

Each of the four filter keys cycles both options on, first only, second only,
then both on again. Disabled options keep their values and unreachable states
are skipped; the cycle never turns both options off. Schedule also respects
Packed mode's disabled Unplanned option. See [Keyboard Shortcuts](keyboard_shortcuts.md)
for typing protection and the browser-local opt-out.

## Related controls

- Plan/project selection: [Top Menu & View Options](topmenu.md) — Plan menu.
- Scope (include ancestors, descendants, dependencies, other team work) and the Selected/Related/Shown task funnel: [Top Menu & View Options](topmenu.md) — Scope menu.
- Timeline scale, card display mode, task sort and graph type: [Top Menu & View Options](topmenu.md) — View menu.
- Scenarios and Tools (plugins): [Scenarios & Saving](scenarios.md) and [Tools Overview](tools_overview.md).
