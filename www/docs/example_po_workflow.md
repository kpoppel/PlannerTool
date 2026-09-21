# Example - Product Owner Workflow

This walkthrough follows Priya, a Product Owner for a single product, as she uses PlannerTool to plan and rebalance work for her team across an upcoming quarter. It uses features covered elsewhere in this manual — follow the links if you want more detail on any step.

## 1. Set up and load data

Priya has already configured her email and Personal Access Token (see [Getting Started](getting_started.md)), so the board loads projects and teams automatically.

- In the Sidebar, she selects her one product's plan and her team, leaving other projects and teams unselected so the board stays focused (see [Sidebar (Filters & Options)](sidebar.md)).
- She sets the Timeline scale to weeks, since she is planning at sprint-level detail (see [Timeline & Board](timeline.md)).

## 2. Review the current backlog on the board

- With Features and Stories expanded under her Epics, Priya scans the board for anything unplanned (no dates) using the "Unplanned" filter.
- She opens [Tool - Plan Health](plugin_plan_health.md) to check for ghosted children (stories without dates under a planned Epic) and parent/child date mismatches before she starts moving things around.

## 3. Try a scenario

- Before changing anything for real, Priya clones the current scenario into "Q3 rebalance draft" (see [Scenarios & Saving](scenarios.md)), so she can experiment freely.
- She drags a few stories later in the timeline to smooth out a spike in her team's allocation, watching the allocation bars on each card update as she goes (see [Card Anatomy & Workflows](card_workflows.md)).
- She checks the [Graph Area](graph.md) in Team mode to confirm her team is no longer over-allocated in the weeks she adjusted.

## 4. Organise related work

- Priya groups a cluster of related stories that make up a single upcoming feature increment using [Groups](groups.md), so she can collapse them to a single pill when she is not actively working on them.
- She adds a "Sprint Review" milestone using [Tool - Plan Events](plugin_events.md) so the team can see the review date directly on the board.

## 5. Push changes back to Azure DevOps

- Happy with the draft scenario, Priya opens the [Review Modal](review_modal.md) via "Save to Azure".
- She reviews the list of proposed date changes, deselects one story she is not ready to commit to yet, and confirms the rest.
- The confirmed changes are written back to Azure DevOps as the source of truth for her team's board.

## 6. Save a view for next time

- Priya saves her current Sidebar selection (her product, her team, weekly scale) as a named View called "My Sprint Planning" (see [Top Menu & View Options](topmenu.md)), so she can get back to this exact setup with one click next sprint.
