# Plugin Contract and Menu Extension

## Implementation Plan

1. Give every static registration an explicit `type`: `hidden`, `tool`, or `menu`.
   Keep identity and display metadata in `modules.config.json`, exposed by a shared
   base metadata method. Remove `section`, `showInTools`, and `autoActivate`.
2. Rename saved startup activation to `activateOnStartup`. Keep instance `active`
   separate. Preserve array order for display and dependency-safe order for loading.
3. Introduce `MenuPlugin` and a dropdown host in `TopMenu`. Opening a menu must not
   activate a plugin or close the current tool. Scope remains the fixed left boundary;
   Tools separates the administrator-selected before/after groups.
4. Extend the existing admin table with type and menu position. Persist schema v2
   and migrate v1 settings with migration 0031; do not add legacy runtime fallbacks.
5. Add a disabled-by-default Sample Menu plugin, its component and custom schema.
   Verify merging, ordering, lifecycle, admin persistence, migration, keyboard use,
   and desktop toolbar overflow. Update admin documentation and the changelog.

## Field Ownership

| Owner | Fields |
| --- | --- |
| Static registration | `id`, `type`, `name`, `description`, `icon`, `version`, `dependencies`, `exclusive`, `persistent`, default `enabled`, default `activateOnStartup`, default `menuPosition` |
| Admin runtime settings | `enabled`, `activateOnStartup`, `menuPosition`, `custom_config`, display sequence as array position |
| Plugin implementation | component loaders/tags, mounting and fullscreen behavior |
| Instance | `initialized`, `active` |

`exclusive` controls tool coexistence; `persistent` preserves an active plugin when
switching tools. Neither is inferred from presentation type. Fullscreen and mount
declaration reconciliation is separate from this extension: existing mounting is
preserved, and fullscreen metadata is derived from implementation inheritance.

Custom configuration schemas contain only plugin-specific options. System fields
such as type, placement, and enabled state do not belong in those schemas.

## Menu Contract

Menu plugins extend `MenuPlugin` and implement `createMenuElement()`. The element
is owned by `TopMenu`, not mounted into the timeline. Its module must be loaded by
an explicit import during `init()`, for native ESM and Vite compatibility.

The top bar renders `Scope | before-tools menus | Tools | after-tools menus`.
Each group preserves the administrator's array sequence regardless of dependency
initialization order. Hidden plugins remain registered but have no menu entry;
disabled plugins are not registered.

Dropdown components may dispatch a bubbling, composed `menu-close` event after a
command. TopMenu handles dismissal, focus return, keyboard navigation, and viewport
positioning. Dropdown openness is UI state, not plugin activation state.

## Upgrade

Run `python3 scripts/migrate.py --apply` before using an existing installation.
Migration 0031 renames `activated`, removes numeric `order`, and initializes
menu placement while preserving array sequence, enabled flags, and custom config.
Existing nonempty v1 payloads are rejected by the v2 API until migrated.