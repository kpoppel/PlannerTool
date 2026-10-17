# Iterations (timeboxes)

Iterations from Azure DevOps can be used as schedule presets to set a task's start and end dates in one step.

## How to use

1. Activate an editable scenario.
2. Open a card's [Details Panel](details.md).
3. In **Scheduling**, open the **Schedule preset** list and choose an iteration. Both dates are set to the iteration's start and end.

The list shows "No date presets available" when no iteration set is configured for the task's plan.

## Where iterations come from

- Administrators create iteration sets from Azure DevOps iteration paths in [Admin - Iterations](admin_iterations.md) and assign a set to each plan in [Admin - Plans](admin_plans.md) (the plan's **Iteration set** field).
- Only iterations with complete start and end dates are offered.
- Reading iterations from Azure DevOps requires a valid Personal Access Token; see [Getting Started](getting_started.md).

Choosing a preset is an explicit action. PlannerTool never infers task dates from the iteration path recorded on a work item.
