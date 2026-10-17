# Best Practices — Azure DevOps & PlannerTool

This page describes recommended conventions and practices for using Azure DevOps with PlannerTool.

## Purpose

PlannerTool reads work items from Azure DevOps (or other backends to come) and interprets states, types, area paths and links.
The tool adds consistent conventions on top of Azure DevOps to produce more useful planning results. While Azure DevOps exert a 'no rules' policy for what can be linked where this tool is an opinionated frontend strengthening the hierarchical relation to planning and helping division of concerns without the need for multiple dashboards or queries to be useful. The tool does not try to replace ADO, but wants to treat ADO as just a database you store things on, while keeping data consistent so you _can_ visit ADO and use it without this tool.

Below you find guidance on the target conventions supported by the tool.

## Planning principles

PlannerTool is a transparency-based planning tool: it shows the work and capacity you explicitly plan, without hidden scheduling assumptions or capacity buffers.

- **Plan every task with start and end dates.** This applies to every work item type, including Epics, Features, Stories, Tasks and Bugs. No task type has implicit date resolution from its hierarchy, state, dependencies or other factors. Tasks without a start and end date remain unplanned and display as unplanned. Use the [Details panel](details.md) to set dates explicitly.
- **Configure available project hours, not total working hours.** Team hours represent time available for delivering project work. The remaining working hours covering holidays, absences, company administration and similar overhead are not specified in PlannerTool. See [Admin - Workforce](admin_workforce.md#available-project-hours).
- **Plan all work consuming project capacity.** Maintenance, internal projects and similar activities must have explicit dates and team allocations. PlannerTool does not reserve implicit buffers for these activities; omitting them makes capacity appear available when it is not.
- **Missing planning data means missing cost coverage, not free work.** A task without a valid start/end date range or an applicable team/group allocation contributes no directly calculated planned hours or cost. A parent can still show rolled-up child costs; that does not mean every task has been estimated. See [Cost Analysis](plugin_cost.md#input-completeness).

Forward planning is only as complete and reliable as its input data. Keep work scope, dates, allocations, available project hours and rates complete, correct and current. PlannerTool cannot account for work or capacity demands that have not been recorded. Numerical precision does not compensate for missing or incorrect inputs, and good input data is necessary but does not eliminate delivery uncertainty.

## Hierarchy guidance

Use hierarchy to express delivery scope and team ownership:

- Epics: high-level product deliveries spanning multiple teams.
- Features/Enablers: team-level deliverables that contribute to an Epic.
- Stories/Tasks/Bugs: team execution items under Features.

Using the hierarchy makes is clear where responsibility lies and whom to work with to understand scope and acceptance of work.

Do not:
- Mix semantic levels. It is possible but not encouraged. For example, make an Epic a child of another Epic in a different plan.
- Use task types as buckets for holding work.  Make every hierachy level count towards actual work needing to be done. This tool considers it bad practice to host "--- next Sprint below here ---" or "Candidates for next release" type buckets. These are logical  groups, not work to scope, plan and complete in itself.

## Use of states

Keep workflow states semantic and stable. As minimum keep meaningfulness to your states. If you are not
using your states, why have any defined?

A suggested simple flow for one set of states is:

- New — work is recorded but not yet planned.
- Defined — the item is ready to be planned (has an estimate and dates).
- Active — development is in progress; scope changes should be rare.
- Resolved — development is complete and ready for delivery.
- Closed — done; PlannerTool does not include closed items in forward planning views.

Another set of states could be this:

- Open — The task is registered but not yet planned.
- Refine — The task is up for getting understood and refined into work which can be completed.
- Ready  — The task is ready for planning.
- In Progress — The task is undergoing active work.
- Waiting — The task is stuck for some reason. It is good style to comment on the task why it is waiting.
- Review — The task is completed and needs to be reviewed by peers and/or requester
- Closed — done; PlannerTool does not include closed items in forward planning views.

Guidance:
- Avoid using state transitions for unrelated metadata (labels, ad-hoc flags) — keep states focused.

## Area path recommendations

- Use one area path/plan per product to group Epics for that product.
- Use separate area/backlog paths/plans for team backlogs when teams need independent planning.
- Prefer a stable area/plan structure; frequent reparenting reduces the usefulness of historical planning data.

## Capacity and allocations

Allocations support **forward resource planning, capacity reservation and budgeting**. They describe intended use of a team's available project capacity over a date range, not actual time spent, progress completed or a guaranteed delivery date. Entering an allocation does not, by itself, establish an up-front delivery commitment. Agree any commitments separately and explicitly with the people doing the work and the relevant stakeholders.

Allocations are stored as a _percentage_ of a team's capacity. Hours and costs are derived using configured available project hours and rates, not total working hours. Percentage allocations do not create automatic slack or hidden buffers; maintenance and internal project work must be planned explicitly.

### Units are not accuracy

Configuration lets you enter allocations in Percent or Man-days. This changes the presentation and entry unit, **not the accuracy or confidence of the estimate**. Both displays round upward to whole numbers, and man-day entry accepts whole days only. Stored fractional percentages preserve the calculation through scheduling changes, saves and publication; numerical precision does not remove uncertainty about the work.

A man-day represents one person's average project working day on the allocated team, not a standard eight-hour day. The conversion uses that team's FTE and the task's inclusive Monday-Friday dates. It does not model individual assignments, holidays or leave calendars.

**Man-day estimates are team-specific, not interchangeable between teams.** Different project-hour assumptions, skills, experience, dependencies and working contexts mean that equal man-day estimates do not imply equal output, elapsed time, cost or likelihood of delivery. Do not use them to rank team productivity or compare estimate accuracy. For cross-team budgeting, use the configured project hours and rates and make the assumptions explicit rather than treating every team's man-day as equivalent.

### Review forecasts and commitments separately

Review allocations with the teams, revisit assumptions as scope and capacity change, and refine longer-range plans as work approaches. Use observed delivery and capacity data to improve forecasts; discuss dependencies and uncertainty rather than presenting a single allocation as a promise.

This is consistent with adaptive planning, not an absence of accountability. For example, the [Scrum Guide](https://scrumguides.org/scrum-guide.html) bases Sprint forecasts on past performance and upcoming capacity, while identifying the Sprint Goal as a commitment with flexibility in the exact work needed to achieve it. An allocation in PlannerTool does not replace those explicit agreements.

So:
- Record capacity allocations as team percentages per work item when teams share work.  Multiple teams can allocate effort on a task.
- For long-running items, avoid large mid-item spikes; split those into separate items to model capacity more accurately.
- Prefer to target effort at well defined time scales:
  - Epics (cross team effort) should be preferred to run its lifecycle over maximum 3 months
  - Features/Enablers (single team) should be preferred to run its lifecycle over maximum 1 month.

Compartmentalising work into smaller but manageable chunks enhances planning agility and models the flow of
work spikes better. The same principle applies to the User Story level: Prefer small equal sized User Stories over
wildly varying tasks.  The team can stop trying to estimate work and just count flow of completed tasks.

## Practical tips

- Keep states, types and area paths documented in your team handbook so everyone follows the same conventions.
- Use PlannerTool's filters and scenarios to validate conventions before pushing changes back to Azure DevOps.
