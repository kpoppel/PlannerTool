# The Main Graph

The graph area displays allocated capacity at the plan level chosen in the View menu. A "plan" is a collection of tasks from a single Azure DevOps area path. Selecting multiple plans adds data to the graph.

## What it is useful for
The graph area provides a visual representation of the capacity allocation for tasks in Azure Devops. It is useful for planning purposes, as it provides a visual representation of the capacity allocation for tasks in Azure Devops.
The graph very quickly gives a complete overview over over and under-utilisation of teams and how the distribution of work is across supported projects.  Using the graph in combination with scenarios is a very efficient way to test out rebalancing of work.

# How does it work? 

The Graph Type control in the View menu offers the container types represented by tasks in Scope, in their configured order. Enabling Ancestors or Descendant work can add graph levels without checking their plans. Team draws team allocation lines from team plans in Scope; any other level (such as Project or Program) stacks plans of that type in Scope. When a saved graph level is unavailable, the nearest available level is shown without changing the saved preference.

Each task's allocation contributes to its own plan and to the plans on its single parent-task chain. A team serving two programs can therefore contribute to both, but work under one program is never charged to the other through the shared team plan. The Plan menu's "Connected to" focus only limits which plans are listed for browsing; it does not change the checked selection.

## Team graph
Team graphs display the sum of capacity allocation calculated per day across all tasks where the team has an allocation.

### Here is an example:

If a team is allocated 50% from 2026-01-01 to 2026-01-10 and again 50% from 2026-01-05 to 2026-01-10:
```

| Date       | Capacity |
| ---------- | -------- |
| 2026-01-01 |    50    |
|     ...    |   ...    |
| 2026-01-05 |   100    |
|     ...    |   ...    |
| 2026-01-11 |     0    |
   
```

The Team graph will highlight areas where teams are over-utilised.  And the graph has a dotted line displaying 100% allocation.

## Higher-level graphs
Project, Program and other configured higher-level graphs use the same team-based organisational weighting. A team of 2 people and a team of 10 people carry equal weight.
This approach enables display of a neutral organisational allocation. It is clear that a team of 2 people more quickly fill up their capacity, but this is built into the allocation model already.

The logic of the calculation is as follows:
- For each team we calculate equal organisational weight. For 10 teams, each team carry 10% of the organisation's total allocation capacity.
- For each day the sum of allocated team capacity multiplied by their organisational weight is calculated. If all teams are allocated 100%, the total organisation's allocation is 100%. If a team in this example is allocated 10%, it's total organisational allocation is 10% of 10%, so 1%.
- This calculation is performed on each selected plan of the displayed type, and the numbers are stacked up in the graph.

The denominator is the full team roster. Team drill-down changes the visible lines in Team mode, but does not change organisational weighting. Work without a parent task in a plan of the displayed type does not appear as a synthetic "Unfunded" plan.
