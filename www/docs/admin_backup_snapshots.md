# Admin - Backup Snapshots

Backup Snapshots is an optional Admin UI screen (enabled by a feature flag on [Admin - System](admin_system.md)) for browsing and restoring timestamped, automatic backups of individual configuration keys — a lighter-weight complement to the manual "Backup All" described in [Admin - Utilities](admin_utilities.md).

## Layout

Snapshots are grouped by configuration key (for example "projects", "teams", "cost"). Each group lists its snapshots with a timestamp and file size.

## Actions per snapshot

- View: opens the raw JSON content of that snapshot in a read-only modal.
- Delete: removes a single snapshot immediately, without confirmation.
- Restore: overwrites the current value of that configuration key with the snapshot's content. This requires confirmation, since it replaces whatever is currently configured.

## Pruning

Set a "Keep last N" value and click "Prune Backups" to delete older snapshots beyond that number, per configuration key. This requires confirmation.

## Notes

Use Backup Snapshots to recover from an unwanted configuration change without needing a full "Backup All" restore — for example, to undo a single bad edit to Projects while leaving Teams, Users and other configuration untouched.
