# Admin - System

The System screen holds general server-level settings and feature flags that do not belong to a more specific screen (Projects, Teams, Data Sources, and so on).

## Editing

Like other structured configuration screens, System offers a schema-driven form and a raw JSON view; Save persists changes and Reload discards local edits and re-fetches the current server value.

## Feature flags

Some optional Admin UI screens are gated behind a flag on this screen. For example, the [Admin - Backup Snapshots](admin_backup_snapshots.md) screen only appears in the sidebar when its flag is turned on here.

## Notes

Because this screen can affect which other Admin UI screens are visible, review changes carefully and confirm with your team before turning experimental flags on for a shared installation.
