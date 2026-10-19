# Iterations (timeboxes)

Iterations can be used as schedule presets to set a task's start and end dates in one step.

## How to use

1. Activate an editable scenario.
2. Open a card's [Details Panel](details.md).
3. In **Scheduling**, open the **Schedule preset** list and choose an iteration. Both dates are set to the iteration's start and end.

The list shows "No date presets available" when no iteration set is configured for the task's plan.

## Where iterations come from

- Administrators create iteration sets using Azure DevOps, a date generator, or manual dates in [Admin - Iterations](admin_iterations.md), then assign a set to each plan in [Admin - Plans](admin_plans.md) (the plan's **Iteration set** field).
- Only iterations with complete start and end dates are offered.
- Only reading the Azure DevOps source requires a valid Personal Access Token; see [Getting Started](getting_started.md). Saved sets are fixed snapshots until an administrator reviews and saves changes.

Choosing a preset is an explicit action. PlannerTool never infers task dates from the iteration path recorded on a work item.
