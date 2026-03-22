# Cost Analysis (v2)

## Overview

The cost analysis provides month-by-month reporting of Internal and External cost and hours across projects, tasks, and teams. The interface highlights allocation discrepancies and enables quick inspection at project, task, and team levels.

## Purpose of this guide

This user guide explains what each view displays and how to interpret the figures.

### Controls

- Plans: select projects from Top menu → Plan. Only selected projects are reported.
- Teams: select teams from Top menu → Team. Team selections affect the Team view.
- Date range: choose From and To to set the displayed months.
- View mode: toggle between Cost and Hours to change the displayed units where relevant.
- Task types are selectable in the sidebar. The default task type selection is all types selected.
- Including unplanned tasks in the calculation. Default is unselected as unplanned work is assigned dates by the tool to becoe visible in the user interface.

The calculation reacts to changes in selections of plans and teams and filters, scenarios and views, so comparisons are easy.

## Reading the tables

- Each table shows monthly Internal and External values for the selected scope. Use the date controls to adjust the months shown.
- The Cost/Hours toggle switches the units used in the tables; it does not alter project or team selections.
- Allocations that span multiple teams are shown per team according to the allocation data.

## Project view

What it shows
- One table per selected plan in the top menu is displayed. The table displays summary data with a monthly breakdown of internal and external cost, and by site.  Both hours and moneytary cost are shown.
- The buttons below the summary table allows you to drill down into individual teams and tasks, listing teams that have allocations for that project and per-month Internal/External values.

When to use
- To answer questions about a plan, typically a project plan with the tree of tasks from participating teams included.

## Task view

What it shows
- A list of tasks for each selected plan inthe top menu and the cost per task along with planned dates andparticipating teams.

When to use
- To get an overview of the per-task cost and participating teams as a table, this data can help determine if a task is worth the spending compared to other tasks.

## Team view

What it shows
- A list of tasks for each selected team in the top menu
- Sums per month and per task is calculated to determine both tem burn, but also total cost for a single team on some task.

When to use
- To review which features a team is working on and the monthly cost or hours impact.

## Empty states and errors

The tool will report reasons why no data is calculated.

- No Projects Selected / No Teams Selected: select items in the Top menu and re-open the plugin.
- No features available: there are no features with dates and allocations for the selected scope.
- Failed to load cost data: a network or server error prevented data retrieval. If this persists, contact your administrator.
