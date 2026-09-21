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

### Scenario-based experimentation

The application supports:

- baseline read-only state from Azure DevOps
- scenario clones for local planning experiments
- saved views for stable team/project filter combinations
- drag-based date and allocation adjustments
- review before pushing changes back to Azure

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

- project and team configuration
- Azure organization and feature-flag setup
- user account and permission management
- cache invalidation and server reload workflows
- schema-driven configuration editing

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
