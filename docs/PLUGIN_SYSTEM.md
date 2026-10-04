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
   and migrate v1 settings with migration 0033; do not add legacy runtime fallbacks.
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

Dropdown menu plugins extend `MenuPlugin` and implement `createMenuElement()`. The element
is owned by `TopMenu`, not mounted into the timeline. Its module must be loaded by
an explicit import during `init()`, for native ESM and Vite compatibility.

The top bar renders `Scope | before-tools menus | Tools | after-tools menus`.
Each group preserves the administrator's array sequence regardless of dependency
initialization order. Hidden plugins remain registered but have no menu entry;
disabled plugins are not registered.

Dropdown components may dispatch a bubbling, composed `menu-close` event after a
command. TopMenu handles dismissal, focus return, keyboard navigation, and viewport
positioning. Dropdown openness is UI state, not plugin activation state.

Direct-action menu plugins publish `menuBehavior: 'toggle'` and implement
`toggleMenu()` instead of a dropdown. The base metadata uses `'dropdown'` and
`menuActive: false`. A toggle plugin reports its owned UI lifecycle through
`menuActive` and emits `MENU_STATUS_CHANGED` when that state changes. TopMenu
shows the active style and `aria-pressed`, without activating or replacing tools.

Shared plugin metadata includes `attentionCounts` (an ordered array of
`{ id, label, icon, count }`) and `attentionStatus` (a scope/status tooltip).
The base plugin supplies `[]` and `''`. When category entries exist, TopMenu
renders nonzero icon/count pairs instead of the aggregate `attentionCount`;
zero pairs are hidden without removing the named menu. These fields are derived
runtime metadata, not persisted configuration.

## Reconciliation Shell

`plugin-reconciliation` is an enabled-by-default menu plugin positioned before
Tools. Administrators may disable or reposition it using the existing plugin
settings. Opening it does not activate a tool or replace the board.

The frontend assessment evaluates baseline and effective scenario data within
the current review scope. Within selected plans precedes Across plans & dependencies everywhere;
category and issue-class counts represent affected tasks. Task rows omit the
single-finding count and show "N findings in this class" only for multiple
constraints of that type; expanded details stay within that class. A task can
appear in both categories. Loading, unavailable data, empty
scope, and assessed health are distinct statuses, not organization-wide audits.

The Reconciliation button opens or closes the non-modal toolbox directly; no
intermediate dropdown or internal close button is rendered. The button remains
active while review exists, including when hidden or opened from a task marker.
Marker selection clears the issue search, expands the selected task, and scrolls
only the toolbox workspace to its details/actions after rendering. Repeated marker
clicks also reveal the task again; ordinary review updates retain scroll position.
The Sidebar stylesheet supplies light blue section wrapping and Task view-style
segmented controls. The first box contains the Reconciliation/scenario heading,
labelled Board warning markers, Issue category, and cross-plan Board context
controls, plus search. A separate Issues & actions box contains expandable issue
classes and inline selected-task dates, class-specific findings, and existing
actions. Header icons are decorative; group labels provide accessible names.

The toolbox overlays the Sidebar. Its edge button hides or
restores the mounted review, preserving category, search, selection, findings,
and scenario identity. Hidden contents are inert and excluded from pointer input.
Locating or opening tasks leaves review active alongside the board and
DetailsPanel; resolved selections remain visible rather than advancing the queue.
Closing review or destroying the plugin removes the overlay and edge button.
The independently mounted `app-footer` remains visible below both Sidebar and
toolbox, and owns its health request lifecycle and selector-derived task count.

Selecting a task or finding automatically reveals its required branches, then
scrolls to and highlights the task after board rendering on every click, including
repeated clicks on the selected task or finding, without moving keyboard
focus. Cross-plan findings default to Relevant context, showing the task and its
loaded relationship path. All tasks removes only the review filter, retaining the
surrounding ordinary scope. Local findings keep those surroundings while revealing
the task. This board-owned temporary presentation does not change assessment scope,
counts, task data, or saved filters; hide/restore preserves it and close/disable
clears it without discarding normal fold/group choices. Live reassessment does not
automatically recenter or advance selection.

The toolbox itself does not mutate tasks or publish changes.
New contextual fix commands, scenario acceptances, save and
publication separation, and asynchronous reconciliation are later slices.

## Upgrade

The server upgrades existing installations before opening an HTTP listener; no
manual migration command is required. Stop older server processes before first
adoption and follow [the database upgrade guidance](MIGRATIONS.md).
Migration 0033 renames `activated`, removes numeric `order`, and initializes
menu placement while preserving array sequence, enabled flags, and custom config.
Existing nonempty v1 payloads are rejected by the v2 API until migrated.