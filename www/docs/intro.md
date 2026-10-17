# PlannerTool Introduction

Welcome to PlannerTool. Kim Poulsen started developing it in 2025 to work around planning shortcomings in Azure DevOps and to replace Excel as a planning tool. It is built to balance the workload of several development teams across projects and features, but it is useful even without capacity data: selecting plans alone gives a clear picture of how work flows over time, including hierarchy and dependencies.

![PlannerTool with four plans selected](img/app_overview.png)

The screenshots in this manual use a synthetic demo organisation ("Contoso") with four plans and four teams. Your own plans, teams and numbers will differ.

# Features

- Plans selected from Azure DevOps area paths, organised in configurable plan levels (for example project and team).
- A timeline board with Normal, Compact and Packed card modes, hierarchy folding and virtual groups.
- Team allocations on tasks, with a capacity graph showing team load and organisational allocation over time.
- Scenarios for safe experimentation, with a review step before selected changes are published to Azure DevOps.
- Saved views for your favourite combination of plans, scope, filters and display options.
- Reconciliation review of schedule conflicts and plan quality issues.
- Tools such as Portfolio Board, XY Board, Cost Analysis, Task History, Plan Events, Annotations and Export.
- A server-side administration area for plans, workforce (teams, suppliers, staffing and cost) and data sources.

The tool is opinionated in how it works and may not fit every organisation. See [Best Practices](best_practices.md) for guidance on states, hierarchy, area paths and capacity.

## Where to go next

- First visit and account access: [Getting Started](getting_started.md) and [Account Access](account_access.md)
- A tour of the screen: [Quick Usage](usage.md)
- Menus: [Top Menu & View Options](topmenu.md)
- Sidebar: [Sidebar (Filters & Options)](sidebar.md)
- The board: [Timeline & Board](timeline.md), [Card Anatomy & Workflows](card_workflows.md), [Groups](groups.md)
- Editing: [Details Panel](details.md), [Scenarios & Saving](scenarios.md), [Review Modal](review_modal.md)
- Capacity: [Graph Area](graph.md)
- Plan quality: [Reconciliation](plugin_reconciliation.md)
- Tools: [Tools Overview](tools_overview.md)
- Keyboard: [Keyboard Shortcuts](keyboard_shortcuts.md)
- Worked examples: [Product Owner Workflow](example_po_workflow.md), [Project Manager Workflow](example_pm_workflow.md)
- Administration: [Admin Overview](admin_overview.md)
