# Best Practices — Azure DevOps & PlannerTool

This page describes recommended conventions and practices for using Azure DevOps with PlannerTool.

## Purpose

PlannerTool reads work items from Azure DevOps (or other backends to come) and interprets states, types, area paths and links.
The tool adds consistent conventions on top of Azure DevOps to produce more useful planning results. While Azure DevOps exert a 'no rules' policy for what can be linked where this tool is an opinionated frontend strengthening the hierarchical relation to planning and helping division of concerns without the need for multiple dashboards or queries to be useful. The tool does not try to replace ADO, but wants to treat ADO as just a database you store things on, while keeping data consistent so you _can_ visit ADO and use it without this tool.

Below you find guidance on the target conventions supported by the tool.

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

This tool considers team capacity in percent.  Not man-hours, FTEs, Story Points, or Velocity.  Experience tells that engineers clearly are eternal optimists, and that _any_ estimate given in directly translatable numbers _will_ be misused by people who does not understand that development is messy, evolving, and emergent.

This tool selects a method of allocating a _percentage_ of a team to a task as a netural measure of how much effort a team of any size would need to set aside, given the team is stable in size.  Using this measure naturally gives a team some slack to absorb emergent development challenges while at the same time allowing planners to work with a measure of capacity as a _derived_ number, given a team size, and a company defined standard number for active project hours per month.

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
