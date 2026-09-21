# Admin - Plugins

The Plugins screen controls which tools are available to users in the main application's Tools menu, in what order, and with what per-plugin configuration.

## The plugin table

Each row is one plugin, showing its name, version and description (read-only, sourced from the plugin's own metadata), plus the following editable controls:

- Enabled: a toggle switch. A disabled plugin cannot be activated by users and does not appear in the Tools menu.
- Activated: only meaningful for plugins that are exclusive/full-screen — at most one such plugin can be marked active by default at a time, and enabling one clears any other.
- Order: up/down controls to change the plugin's position, which affects its order in the Tools menu.
- Config: opens an editor for the plugin's own `custom_config`, using a schema-driven form when the plugin declares one, or a raw JSON editor otherwise.

Rows missing a required id are highlighted with a warning badge and block saving until fixed.

## Saving

Click Save to persist all changes to the plugin table atomically; click Reload to discard local edits and re-fetch the current server configuration.

## Notes

- Some plugins ship disabled by default (for example Link Editor) — enable them here if your users need them.
- Per-plugin configuration edited here is the same "admin/global config" scope described for administrators; it is distinct from a user's own personal view settings, which users control themselves inside the main application.
- After changing which plugins are enabled, users should reload the main application to see the updated Tools menu.
