# Sidebar — Team Drill-down & Task Filters

The Sidebar no longer hosts view options, plan/project selection, scenarios or plugin controls — those now live in the Top Menu (see [Top Menu & View Options](topmenu.md)). The Sidebar itself has two focused sections: a context-sensitive list of teams involved in the plans you've selected, and the task filters that narrow down what is displayed on the board.

## Team Drill-down

- Lists only teams explicitly allocated to tasks in the selected plans and enabled Scope. The list updates as plan selection or Scope changes.
- Each team row shows a color dot (click to open the color popover), the team name, and counts for the two highest-ranking nonempty task types in the configured hierarchy. When more types have counts, expand **Counts** to see the full table. Types with no counts across the listed teams are omitted; individual zero cells are blank.
- Counts show the number of tasks explicitly allocated to that team anywhere in the loaded data, including active scenario changes. Each task is counted once per allocated team, not by allocation percentage or by which plan the team belongs to. Tasks without a team allocation do not contribute to team counts.
- These counts are not limited to selected plans, enabled Scope, team focus, or task filters. They are an allocation overview, not the number of that team's tasks you should expect to find in the current display. The team list is scope-limited; its counts are not.
- Click a team row to select or deselect it for display. On the [Graph Area](graph.md), team selection changes visible team lines, not organisational weighting or allocation calculations.
- Use the "All" / "None" toggle above the list to quickly select or deselect every team at once.
- Task view below the list offers **Plan overview** (default), which keeps unallocated tasks in the selected plans, and **Team focus**, which shows only tasks allocated to selected teams plus their parent tasks for context. With no teams selected, Team focus shows no tasks.
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
