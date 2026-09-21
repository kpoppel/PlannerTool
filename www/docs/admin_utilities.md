# Admin - Utilities

Utilities collects maintenance actions for keeping a PlannerTool installation healthy: backups, cache cleanup and configuration reload. For clearing Azure DevOps data caches specifically, see [Admin - Cache Invalidation](admin_cache_invalidation.md).

## Backup & Restore

- "Backup All" downloads a single JSON file containing configuration, users, views and scenarios. Cached Azure DevOps data is not included — back up your configuration, not a copy of Azure DevOps itself.
- To restore, choose a backup file, tick which parts to restore (Config, Users, Views, Scenarios), and click "Restore Selected". This is a destructive action and requires confirmation, since it overwrites the corresponding current data.

## Cache Cleanup

"Clean Up Orphaned Entries" removes leftover cache index entries that no longer point at real cache data, for example after area paths were changed or cache files were deleted manually outside the application. This does not clear valid cache data, only stale index entries.

## Reload Configuration

"Reload Config" asks the server to reload its configuration artifacts and invalidate related runtime caches. Use this after editing configuration files directly on the server outside the Admin UI.

## Notes

- Destructive actions (Restore, Reload, cache invalidation) all require confirmation before running.
- Status messages report how many items were affected once an action completes.
