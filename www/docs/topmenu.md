# Top Menu & View Options

The top menu holds the menus that decide what is shown on the board, plus the board counter, settings and help.

![Top menu](img/topmenu.png)

From left to right:

- **View**: timeline scale, card mode, task sort, graph type and saved views. The badge shows the active view.
- **Scenario**: switch, copy, save, publish, rename or delete scenarios. The badge shows the active scenario. See [Scenarios & Saving](scenarios.md).
- **Plan**: choose which plans are on the board. The badge shows the plan name, or the number of selected plans.
- **Team filter**: choose Plan or Team work and select teams.
- **Filters**: expand or collapse hierarchy and choose task types, states and advanced filters. See [Task List and View Context](sidebar.md).
- **Reconciliation**: schedule conflicts and plan quality findings, with counts per category. See [Reconciliation](plugin_reconciliation.md).
- **Tools**: optional tools such as Portfolio Board or Cost Analysis. See [Tools Overview](tools_overview.md).
- **N on board**: board information, explaining how the number of cards on the board is reached.
- **🔔 Notification log**: appears when the application has reported notifications (for example warnings from the server). It lists each message with severity, source and time; **Clear log** empties it.
- **⚙ Settings**: Configuration and, for administrators, links to the administration sections.
- **?**: this Help.

Menus close with Escape or by clicking outside them. Left and right arrow keys move between the top menu entries.

## View menu

![View menu](img/menu_view.png)

- **Timeline Scale** (`t`): 3mo, Weeks, Months, Quarters or Years.
- **Cards** (`c`): Normal or Packed. See [Timeline & Board](timeline.md) for examples.
- **Task Sort** (`s`): Rank (backlog order) or Date. Unavailable in Packed mode.
- **Graph Type** (`g`): one button per plan level represented in the current scope (for example `project` and `team`). It controls which level the [Graph Area](graph.md) shows.
- **Saved Views**: click a view to apply it. Your own views have buttons to update it with the current settings (💾), rename it (✏️) and delete it (🗑️).
- **💾 Save Settings as View**: saves the current plans, filters, team selection and display options under a new name.

## Plan menu

![Plan menu](img/menu_plan.png)

- Plans are grouped by plan level (configured by your administrator, see [Admin - Plans](admin_plans.md)). Click a plan to include or exclude it.
- The columns to the right count the plan's tasks per work item type.
- Click a plan's colour dot to change its colour.
- **All** / **None** selects or clears the plans currently listed.
- **Connected to** narrows the list to plans linked to one chosen plan through task ancestry. It does not change which plans are checked. Choose **All plans** to clear it. While a focus is active, **Clear hidden** appears when checked plans are hidden by the focus, and unchecks only those. Saved views remember the focus.

![Connected to](img/menu_plan_connected.png)

Which teams appear in the Teams menu depends on the plans selected here (see [Teams](sidebar.md#team-drill-down)).

## Related work

Use the parent arrow when a task's parent is missing from the board, and its chevron to expand a level down. These reveals leave the selected plans and workload calculations unchanged. Use **Tools > Dependencies** to draw links between tasks already shown, or [Team Drill-down](sidebar.md#team-drill-down) to see a team's work across plans.

## Board information

![Board information](img/board_information.png)

Click **N on board** to see how the base task count is reached: tasks counted in the selected plans, shared tasks counted once, and tasks added or excluded by the current mode, filters and team focus. Hover a row for an explanation. The footer shows how many teams are in scope.

## Tools menu

![Tools menu](img/menu_tools.png)

Each entry shows a status dot and version. Click a tool to activate it, and again to deactivate it. Which tools are available is configured by your administrator in [Admin - Plugins](admin_plugins.md).

## Using views

- A view captures the selected plans, Plan menu focus, filters, team selection and View menu options.
- Loading a view applies its selections immediately.
- Most View menu options, board zoom and search also have a [keyboard shortcut](keyboard_shortcuts.md). Plain letters work outside text fields, menus and dialogs. Disable them with **Configuration > Letter shortcuts**, then **Save**.
