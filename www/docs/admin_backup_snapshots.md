# Admin - Backup Snapshots

Backup Snapshots (`#backup-snapshots`, full administrators only) lists automatic backups of individual configuration values. The section appears only when **Manage Backup Snapshots** is enabled in [Admin - Server](admin_server.md); reload the administration page after enabling it.

While the flag is on, every configuration save first stores the previous value as a timestamped snapshot. Saves made while the flag was off have no snapshots.

## Layout

Snapshots are grouped by configuration key (for example `projects` or `server_config`) with a count. Each row shows **Timestamp** and **Backup Key**, with **View**, **Restore** and **Delete** actions.

## Actions

- **View** opens the snapshot's JSON in a read-only "Snapshot Content" dialog.
- **Restore** overwrites the current value of that configuration key with the snapshot, after confirmation.
- **Delete** removes the snapshot after confirming `Delete backup "key"?`.
- **Prune: keep last** (default 5) with **Prune** deletes older snapshots beyond that number per key, after confirmation.

## When to use it

Use a snapshot to undo a single unwanted configuration change, for example a bad edit to plans, without restoring a full system backup. Full backups are made in [Admin - Utilities](admin_utilities.md) under **Backup & Restore > System**.
