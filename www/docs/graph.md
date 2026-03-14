# The Main Graph

The graph area displays the allocated capacity on plans for two types of plans.  A "plan" is a collection of tasks from a single Azure Devops area path. Selecting multiple plans adds data to the graph.

## What it is useful for
The graph area provides a visual representation of the capacity allocation for tasks in Azure Devops. It is useful for planning purposes, as it provides a visual representation of the capacity allocation for tasks in Azure Devops.
The graph very quickly gives a complete overview over over and under-utilisation of teams and how the distribution of work is across supported projects.  Using the graph in combination with scenarios is a very efficient way to test out rebalancing of work.

# How does it work? 

The graph displays in two modes which are mutually exclusive:
- Team graph
- Project graph

The team graph uses only data from plans of the "team" type, while the project graph uses data from plans of type "project". The type of plan is configured in the admin interface.

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

## Project Graph
The project graph is more complicated. This is an opinionated graph which disregards traditional focus on individuals in teams and rather supports a team-based approach.  This means a team of 2 people and a team of 10 people carry equal weight in the project graph.
This approach enables display of a neutral organisational allocation. It is clear that a team of 2 people more quickly fill up their capacity, but this is built into the allocation model already.

The logic of the calculation is as follows:
- For each team we calculate equal organisational weight. For 10 teams, each team carry 10% of the organisation's total allocation capacity.
- For each day the sum of allocated team capacity multiplied by their organisational weight is calculated. If all teams are allocated 100%, the total organisation's allocation is 100%. If a team in this example is allocated 10%, it's total organisational allocation is 10% of 10%, so 1%.
- This calculation is performed on each selected project and the numbers are stacked up in the graph.

### Allocations with no parent in a project plan:
- Tasks may have team allocations, but are not parented in a task from a plan of the type "project".
- All of these tasks are combined into a virtual project and is displayed in the graph as well.

This can, depending on the organisation, be interpreted as "unfunded" work, or simply work that needs to be done for non-project purposes.  Tasks involving improvement of quality of work, refactoring, tool maintenance etc. could fall under this category.
