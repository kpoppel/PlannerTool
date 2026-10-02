# Admin - Plugins

The Plugins screen controls which plugins are enabled, their display order, startup activation, and per-plugin configuration.

## The plugin table

Each row shows name, version, type and description from the static registration.

- Type: `tool` appears inside Tools, `hidden` has no menu entry, and `menu` contributes its own top-menu dropdown. Type is not editable here.
- Enabled: a disabled plugin is not loaded and contributes no menu entry.
- At Startup: selects the single plugin to activate when the application starts. Menu plugins have no startup-activation control; opening their dropdown does not activate a tool.
- Menu Position: menu plugins can appear Before Tools or After Tools. All plugin menus remain to the right of Scope.
- Order: up/down controls set display sequence within Tools and within each top-menu position. Dependencies can change initialization order, but not display sequence.
- Config: opens an editor for the plugin's own `custom_config`, using a schema-driven form when the plugin declares one, or a raw JSON editor otherwise.

Rows missing a required id are highlighted with a warning badge and block saving until fixed.

## Saving

Click Save to persist all changes to the plugin table atomically; click Reload to discard local edits and re-fetch the current server configuration.

## Notes

- Some plugins ship disabled by default (for example Link Editor) — enable them here if your users need them.
- Per-plugin configuration edited here is the same "admin/global config" scope described for administrators; it is distinct from a user's own personal view settings, which users control themselves inside the main application.
- After saving changes, users should reload the main application to see the updated menus.
- Sample Menu ships disabled. Enable it to display a planning-scope summary and counter. Its initial counter value is configurable; closing and reopening the menu retains the counter until the application reloads.
- The server upgrades existing plugin settings to schema v2 during startup, before opening an HTTP listener; no manual migration command is required.
