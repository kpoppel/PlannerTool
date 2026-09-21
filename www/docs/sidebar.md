# Sidebar — Team Drill-down & Task Filters

The Sidebar no longer hosts view options, plan/project selection, scenarios or plugin controls — those now live in the Top Menu (see [Top Menu & View Options](topmenu.md)). The Sidebar itself has two focused sections: a context-sensitive list of teams involved in the plans you've selected, and the task filters that narrow down what is displayed on the board.

## Team Drill-down

- Lists only the teams that are actually allocated to work in your currently selected plans (from the Plan menu) — the list updates automatically as your plan selection changes.
- Each team row shows a color dot (click to open the color popover), the team name, and a per-task-type count badge showing how many tasks of that type the team has.
- Click a team row to select or deselect it; deselecting a team removes its tasks from the board and, on the [Graph Area](graph.md), also removes it from the organisational capacity calculation.
- Use the "All" / "None" toggle above the list to quickly select or deselect every team at once.
- If the selected plan(s) have no teams assigned, the section shows a short message instead of an empty list.

## Task Filters

Task Filters narrow down which tasks are displayed, independent of which plans and teams are selected:

- Schedule: Planned / Unplanned.
- Allocation: Allocated / Unallocated.
- Hierarchy: Has Parent / No Parent.
- Relations: Has Links / No Links.
- State: dynamic list populated from the loaded features — click a state to toggle it, the colored dot matches its configured state color.
- Task Types: dynamic list (Epic, Feature, etc.), ordered per the task type hierarchy configured by your administrator.

A filter option is greyed out and disabled when it is "not relevant in current tool context" (for example while a full-screen tool such as Portfolio Board or XY Board is active).

## Related controls

- Plan/project selection: [Top Menu & View Options](topmenu.md) — Plan menu.
- Scope (include ancestors, descendants, dependencies, other team work) and the Selected/Related/Shown task funnel: [Top Menu & View Options](topmenu.md) — Scope menu.
- Timeline scale, card display mode, task sort and graph type: [Top Menu & View Options](topmenu.md) — View menu.
- Scenarios and Tools (plugins): [Scenarios & Saving](scenarios.md) and [Tools Overview](tools_overview.md).
