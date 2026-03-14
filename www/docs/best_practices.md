# Best Practices — Azure DevOps & PlannerTool

This page describes recommended conventions and practices for using Azure DevOps with PlannerTool.

## Purpose

PlannerTool reads work items from Azure DevOps and interprets states, types, area paths and links.
The tool adds consistent conventions in Azure DevOps to produce more useful planning results. While
Azure DevOps exert a 'no rules' policy for what can be linked where this tool is an opinionated
frontend strengthening the hierarchical relation to planning and helping division of concerns without
the need for multiple dashboards or queries to be useful.

Below you find guidance on the target conventions supported by the tool.

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

## Hierarchy guidance

Use hierarchy to express delivery scope and team ownership:

- Epics: high-level product deliveries spanning multiple teams.
- Features/Enablers: team-level deliverables that contribute to an Epic.
- Stories/Tasks/Bugs: team execution items under Features.

Do not mix semantic levels (for example, make an Epic a child of another Epic in a different product path).
The PlannerTool is not intended to work with tasks below the "Feature" level. Azure DevOps have sprint boards
which does the job just fine.

## Area path recommendations

- Use one area path per product to group Epics for that product.
- Use separate area/backlog paths for team backlogs when teams need independent planning.
- Prefer a stable area structure; frequent reparenting reduces the usefulness of historical planning data.

## Capacity and allocations

- Record capacity allocations as team percentages per work item when teams share work.
- For long-running items, avoid large mid-item spikes; split those into separate items to model capacity accurately.
- Prefer to target effort at well defined time scales:
  - Epics (cross team effort) should be preferred to run its lifecycle over maximum 3 months
  - Features/Enablers (single team) should be preferred to run its lifecycle over maximum 1 month.

Compartmentalising work into smaller but manageable chunks enhances planning agility and models the flow of
work spikes better. The same principle applies to the User Story level: Prefer small equal sized User Stories over
wildly varying tasks.  The team can stop trying to estimate work and just count flow of completed tasks.

## Practical tips

- Keep states, types and area paths documented in your team handbook so everyone follows the same conventions.
- Use PlannerTool's filters and scenarios to validate conventions before pushing changes back to Azure DevOps.

## Further reading

See the Configuration and Scenarios pages in this Help index for steps on connecting PlannerTool and saving scenarios.
