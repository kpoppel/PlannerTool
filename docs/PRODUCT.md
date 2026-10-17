# Product Overview

## Purpose

PlannerTool is a planning and portfolio-visibility product for Azure DevOps teams scoped with optional support for other backends. It combines a task board, scenario-based planning, capacity views, dependency overlays, and admin configuration into one system designed for teams that need to reason about delivery capacity before committing work. It provides support for arbitrary depth of task handling across multiple plans, enabling for example a hierarchy of project control through teams, projects, programs, and strategic projects to be interconnected and handled in one coherent user interface.

The v.5 release centers the product around a scope-first planning model:

- a canonical application store drives the UI
- selected scope determines which work is considered
- context and team drill-down shape what is displayed
- scenarios keep planning experiments separate from the baseline
- plugins extend the experience without replacing the core planning model

## What the product does

### Planning work in context

PlannerTool helps users:

- load plans and teams from Azure DevOps
- view the work in hierarchical and scoped contexts
- include parent/child/dependency/other allocations as needed
- filter by project, team, task type, state, and relationship
- evaluate organization-level and team-level capacity in the same planning session
- allows logical grouping of tasks without breaking the intent of tasks representing an actual delivery more than a bucket to keep tasks in.

### Board Scope and Team Focus

- Plan overview shows all display-eligible work in the selected scope, independently of team selection.
- Ancestors and Descendant work include eligible hierarchy paths at every loaded level.
- Team focus shows selected-team allocations, their connecting ancestors, and unallocated descendants.
- Other-team-only descendant branches are excluded unless they contain selected-team work; connecting ancestors remain as context, without including unrelated siblings.
- Scope options and schedule, allocation, hierarchy, relations, state and task-type filters still apply.
- Hierarchy relevance never creates team allocations or changes assigned-task counts, capacity or cost calculations.

### Scenario-based experimentation

The application supports:

- baseline read-only state from Azure DevOps
- scenario clones for local planning experiments
- saved views for stable team/project filter combinations
- drag-based date and allocation adjustments
- review before pushing changes back to Azure

### Allocation units

Configuration offers a browser-local allocation unit: Percent (default) or Man-days. A project man-day is one person's average project working day, not a fixed eight-hour day. DetailsPanel uses allocation percent / 100 x internal/external FTE x inclusive Monday-Friday days, without holidays or leave. Monthly project hours cancel in this conversion. Groups use their existing aggregate FTE.

Man-day entry accepts whole days only. Both man-day and percentage displays round upward to whole numbers; zero is displayed only for an actual zero. Stored and published allocations retain fractional percentage precision, including through scenario saves and Azure reloads. Scheduling and financial calculations use those precise values, not the rounded display. Feature cards, allocation bars and graphs remain percent-based. Changing units, leaving a displayed value unchanged, or refreshing data does not rewrite allocations. Existing integer allocations remain valid.

In Man-days mode, scheduling preserves previous effort against final dates. If preserving effort would exceed 100% for any allocation, the entire scheduling operation is rejected with a warning; existing dates and allocations remain unchanged. Extend the schedule or reduce the allocation before retrying. Rows with missing/zero staffing or invalid or zero-working-day schedules are removed. Failed/loading staffing and protected duplicate unknown-team allocations block the batch instead. Retry staffing in Configuration or switch to Percent. Notifications explain removals. Existing feature/scenario revert controls recover changes; feature revert removes all of that feature's overrides.

Parents still cannot end before their scheduled children. Man-day edits report the limiting child and date; parent resizing does not compress descendants. Propagated changes may require reverting other affected features or the scenario.

### Visual planning surfaces

The product includes:

- a feature timeline and board view
- a capacity graph for team and organization planning
- dependency overlays and planning annotations
- grouping and nested task grouping across plans
- full-screen plugins for portfolio analysis and export workflows
- board zooming

### Admin and configuration

The server and admin interface support:

- delegated Plans administration with guided creation, explicit edit/save,
  within-level reordering, archive/restore, plan levels and workforce defaults
- project-driven Azure DevOps process loading and reviewed work item type imports
- process-ordered type tiers with sibling types and per-type ADO state sequences
- team configuration
- Azure organization and feature-flag setup
- user account and permission management
- cache invalidation and server reload workflows
- schema-driven configuration editing

Users with `manage_projects` can create the first plan without configuring a
process catalogue beforehand. Choosing an ADO project loads only its process;
saving imports the selected eligible types with the plan. Task-level types cannot
be imported. Azure DevOps Processes reviews discovery imports, while Global
Project Settings arranges processes and type tiers. Raw plan JSON is admin-only.

Each plan selects its work item types and a closed-work history window, defaulting
to None. No per-plan fetch/display state lists are needed. Completed items linked
to active work remain available regardless of that window; all-Completed linked
work uses the longest source-plan window. Removed and unimported types are excluded.
Planner filters group types by process and distinguish same-named types across
processes; sibling types do not imply a parent/child relationship.

Creating a plan, changing its data selection or restoring it immediately loads
its work items. Saving and loading are separate: failed loads keep the saved plan
and offer Retry. A refresh that cannot read all configured work never publishes
partial data; the previous complete snapshot remains available with an access
warning to the requesting user.

Fresh installations use generated demo data without requiring an ADO PAT. With
live ADO selected, every account must configure a valid PAT, and all ADO requests
use the acting user's credentials. Account credential repair remains reachable.

## Core user value

PlannerTool is designed to reduce the cost of planning conversations by making hidden assumptions visible:

- what work is in scope
- which teams carry the load
- how much capacity is available and allocated
- which dependencies affect the plan
- what changes are still only in a scenario and not yet committed

## Product principles

- A single canonical state model keeps the UI consistent.
- Scope is explicit: the selected tasks and context are separate from display filters.
- Plugins extend the product without replacing the planning core.
- Server data is durable; remote cache is disposable and safe to invalidate.
- Scenario and view state are first-class user artifacts.

## Target users

- delivery leads and project managers
- team leads balancing capacity across multiple plans
- planners who need to compare scenarios before committing changes
- administrators managing shared planning configuration

## Current product posture

PlannerTool is not a generic TODO board. It is a scoped planning tool for delivery capacity and portfolio reasoning across Azure-backed work, designed to support teams that need a richer, data-aware planning workflow than raw backlog tracking. The tool provides functionality Azure DevOps does not provide any reasonable way to achieve since Azure DevOps is inherently a large database with the primary purpose to log work tasks.
