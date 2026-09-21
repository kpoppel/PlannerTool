# Example - Project Manager Workflow

This walkthrough follows Marcus, a Project Manager responsible for a portfolio of projects delivered by several teams in a non-agile organisation, sitting one level above individual Product Owners. Where Priya (see [Example - Product Owner Workflow](example_po_workflow.md)) plans one product in detail, Marcus is more concerned with cross-project capacity, dependencies and reporting upward.

## 1. Get an organisation-wide view

- In the Sidebar, Marcus selects every project in his portfolio and every team that contributes to them, rather than a single product (see [Sidebar (Filters & Options)](sidebar.md)).
- He sets the Timeline scale to months, since he is looking at a multi-quarter horizon rather than individual sprints.
- He switches the [Graph Area](graph.md) to Project graph mode to see organisational capacity across all his projects, and deselects a couple of purely internal support teams so they do not skew the organisational-weight calculation.

## 2. Check overall plan health

- Marcus opens [Tool - Plan Health](plugin_plan_health.md) across the full portfolio to catch hierarchy violations, dependency violations and state inconsistencies before he reports status upward.
- He opens [Tool - Dependencies](plugin_dependencies.md) (via the Scope menu) to see cross-team dependency arrows and identify any project that is blocked waiting on another team's delivery.

## 3. Look for capacity conflicts

- Using [Tool - Portfolio Board](plugin_portfolio.md), Marcus reviews every team's work by state in one Kanban-style screen, which is a faster way to spot idle or overloaded teams than scrolling the full timeline.
- He switches to [Tool - XY Board](plugin_xyboard.md) with X = Team and Y = State to get a matrix view of exactly how much work each team has in each state, which he uses directly in his status reporting.

## 4. Model a what-if scenario

- Marcus wants to see the impact of delaying one project by a month without committing to it yet. He clones the current scenario (see [Scenarios & Saving](scenarios.md)) into "Delay Project X - draft".
- He drags the relevant Epics later on the timeline and checks the Project graph again to see the effect on organisational allocation.
- He adds milestones for steering committee dates using [Tool - Plan Events](plugin_events.md) so both scenarios show the same key dates for comparison.

## 5. Track cost impact

- Marcus opens [Tool - Cost Estimates & Teams](plugin_cost.md) and switches to Project view to see the internal/external cost and hours impact of the draft delay, month by month, before presenting the option to stakeholders.

## 6. Report and hand off

- Marcus uses [Tool - Export Timeline](plugin_export.md) to produce a PNG of the current portfolio timeline for his status deck.
- Once a direction is agreed, he either pushes the confirmed scenario back to Azure DevOps via the [Review Modal](review_modal.md), or hands the scenario back to the relevant Product Owner to refine at the sprint level themselves.
- He saves his portfolio-wide selection as a View called "Portfolio Status Review" so he can reproduce this exact reporting view every reporting cycle (see [Top Menu & View Options](topmenu.md)).
