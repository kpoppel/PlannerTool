# Admin Overview

PlannerTool has a separate administration interface, used to configure the server-side data every planning user relies on: projects, teams, people, cost rates, iterations, plugins and users.

## Accessing the Admin UI

- Open the Admin UI at the `/admin` path of your PlannerTool installation.
- The first time an installation is used, no admin account exists yet: the login page shows a "First-time setup" notice and asks for an email address and a Personal Access Token (PAT) to register the first administrator.
- On later visits, sign in with your email address only; your session is remembered in a browser cookie.
- If you sign in with an account that does not have admin permission, you are sent back to the login page with an error and cannot open any admin screen.

## Permission model

- Access to the Admin UI is gated by a single `admin` permission — there is currently no per-screen role split. Any admin account can view and edit every screen described below.
- Manage who has this permission from [Admin - Users](admin_users.md).

## What you can configure

- [Admin - Projects](admin_projects.md): map Azure DevOps area paths to plans PlannerTool users can select.
- [Admin - Teams](admin_teams.md): define your team structure.
- [Admin - People](admin_people.md): maintain the people/resource database used for capacity and cost.
- [Admin - Cost Configuration](admin_cost_config.md): rates and parameters used by the Cost Analysis tool.
- [Admin - Global Project Settings](admin_global_settings.md): the task type hierarchy and state display sequence shared by all projects.
- [Admin - Area Mappings](admin_area_mappings.md): which delivery plans apply to which area paths.
- [Admin - Iterations](admin_iterations.md): named sets of Azure DevOps iterations available to projects.
- [Admin - Data Sources](admin_data_sources.md): where each type of data is fetched from, and cache lifetimes.
- [Admin - Plugins](admin_plugins.md): enable, disable, order and configure tools.
- [Admin - Users](admin_users.md): manage accounts and admin permission.
- [Admin - System](admin_system.md): general server settings and feature flags.
- [Admin - Utilities](admin_utilities.md): backup/restore, cache cleanup and configuration reload.
- [Admin - Cache Invalidation](admin_cache_invalidation.md): force a fresh fetch of Azure DevOps data.
- [Admin - Backup Snapshots](admin_backup_snapshots.md): browse and restore timestamped configuration backups (if enabled).

## Common conventions

Most configuration screens follow the same pattern:

- A Save button persists your edits; a Reload button discards local edits and re-fetches the current server value.
- Screens with structured data offer both a friendly form and a raw JSON editor — use whichever is more convenient, they edit the same underlying value.
- Status messages after Save briefly show success or a validation error and then clear automatically.
- Changes made in the Admin UI apply immediately server-side; users of the main application see them after their next data refresh or browser reload.
