# Admin Overview

The administration area configures what everyone sees in PlannerTool: plans, workforce, data sources, users and server settings.

![Administration area](img/admin_plans.png)

## Accessing the admin area

- Open it from the planner's gear (Settings) menu: the **Administration** group links directly to each section you may manage. The admin area itself has a **← Planner** link back.
- The admin area uses the same enrolled browser session as the planner (see [Account Access](account_access.md)). Without a session, the login page offers **Open planner** to enroll or add this browser. An account without any administration permission sees "This account has no administration permissions."
- The first account enrolled on a new installation becomes the administrator.
- Each section has its own address, for example `/admin/#workforce`, so links and bookmarks open the right section.

## Permissions

Full administrators (`admin`) see every section. Administrators can also delegate parts of the work to other users in [Admin - Users](admin_users.md):

| Delegated permission | Label in Users | Sections |
| --- | --- | --- |
| `manage_projects` | Projects | Plans, Azure DevOps Processes, Global Project Settings |
| `manage_workforce_teams` | Workforce teams & staffing | Workforce (groups, teams, staffing) |
| `manage_workforce_costs` | Workforce costs & suppliers | Workforce (suppliers, profiles) |
| `manage_iterations` | Iteration mappings | Iterations |

All other sections are for full administrators only.

## Sections

- [Server](admin_server.md): server name, log level and feature flags.
- [Data Sources](admin_data_sources.md): where work items, history, plans and events come from, and cache lifetimes.
- [Users](admin_users.md): accounts, administrators, delegated permissions and access resets.
- [Plugins](admin_plugins.md): which tools are available, their order and configuration.
- [Plans](admin_plans.md): plans (area paths), plan levels and default workforce per level.
- [Azure DevOps Processes](admin_ado_processes.md): which work item types are imported from each process.
- [Global Project Settings](admin_global_settings.md): process order and work item type tiers.
- [Workforce](admin_workforce.md): groups, teams, suppliers, profiles and staffing — the basis for allocations and cost.
- [Area Mappings](admin_area_mappings.md): Azure DevOps Delivery Plans used for [Plan Markers](plugin_markers.md).
- [Iterations](admin_iterations.md): iteration sets used as schedule presets.
- [Utilities](admin_utilities.md): backup and restore, workforce transfer, cache cleanup and invalidation, configuration reload.
- [Backup Snapshots](admin_backup_snapshots.md): automatic per-save backups (only when enabled on the Server page).

## Common conventions

- Most sections save with an explicit **Save** button; Plans and Users save each change immediately.
- **Reload** discards unsaved edits and re-reads the server's current values.
- Server, Plans (full administrators), Area Mappings and Iterations also offer a raw JSON mode for bulk edits.
- Changes take effect for users when they reload the planner.
