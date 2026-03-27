# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project should strive to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Template:

## [v] - unreleased
### Added
### Changed
### Fixed

---
## [v3.0.0] - unreleased

After installing this release, restore backups on a clean data directory.

### Added
- SQLite backend storage introduced.
- Storage migration from file-based pickle to diskcache for accounts, admin accounts, views, scenarios
  and all cached task data.
- Memory cache layer for Azure data to provide faster data returns.
  - The caching is shared among all users, so only the user triggering a read after cache timeout will
    experience a small initial wait.
- New API endpoints for cache control: `/api/cache/load` and `/api/cache/refresh`
- Cache warmup service loads disk cache into memory on server boot
- Admin UI support added for memory cache configuration (enable_memory_cache flag, max_size_mb, staleness_seconds)

### Changed
- All pickle storage now uses diskcache backend
- AzureCachingClient now supports on-demand refresh using user PAT
- Cache freshness tracked per-area with configurable staleness threshold
- Memory cache automatically marks entries as stale after staleness_seconds threshold
- Memory cache enforces size limits with LRU eviction when exceeding max_size_mb
- Performance: API response times improved from 100-500ms to <50ms for cached data
- File-based pickle storage is replaced with diskcache
- single_file_backend.py - unused storage backend removed
- people_storage_backend - config variable - unused configuration removed
- accessor.py - test-only navigation helpers removed (ValueNavigatingStorage, DictAccessor, ListAccessor, StorageProxy)
- PickleSerializer - removed to be replaced by diskcache
- pickle_serializer - config variable - no longer needed
- Test files - testing accessor and pickle functionality removed
- Removed featureflags no longer relevant
- All admin interface API calls now go through providerREST so that sub-ptah handling is centralised
- npm modules updated to newer versions which are not deprecated
- Session logging drops an INFO when sessions are initiated to help with debugging

### Fixed
- enable_brotli_middleware feature flag was newer actually used due to wrong flag check.

## [v2.2.0] - 2026-03-27

NOTE: This is the last v2.x release. BACKUP YOUR DATA! From v3.0.0 onwards the pickled files
are gone and replaced by a SQlite database. Current pickled files cover cached task and history data
from the plans as well as user accounts, scenarios and views for those users.
These will be stored in the new SQLite data from the next major release.
Migrating to v3.x involves updating to this release, making a backup, then upgrade to v3.x and
restoring the backup.

## [v2.2.0] - unreleased
### Added
- Added backup/restore to the admin interface. This will dump a JSON file with all data.
  Note account data is also stored in the file, so don't send it around as tokens are in there.
- Docker compose setup with caddy to serve multiple instances on the same machine on port 80
  The Dockerised version will use the vite build system to ensure cache busting
- On first start, the application will redirect to the admin interface for first account creation

### Changed
- Project service will return {} if no projects are defined - as is the case on a fresh install.
- Application will use window.APP_BASE_URL to determine its real path.

### Fixed
- Login screen on first account setup would not redirect to admin interface
- Login screen on first account setup would not authenticate because localstorage is used to store
  current user email.

## [v2.1.0] - 2026-03-23

### Added
- PluginCostV2: New cost analysis plugin with Project/Task/Team views, monthly cost/hours breakdowns, task tree with budget deviation indicators
  It upgrades the old plugin by having a simpler, less colorful interface, and supporting three views of cost data for plans, team and task level.
  It also reacts to filter changes and selections which the old plugin did not so.
- The sidebar allows others UI elements to disable and programmatically change filter settings. disabled elements are dimmed to hint the user on
  still-active elements while keeping the setting of disabled elements visible.
- Vite bundling, building dist/ static files. App will bust the browser cache when new files are added or existing changed.
  This should ensure the users don't have to manually clear the browser cache any longer.

### Removed:
- The new cost plugin does not have the ability to hint budget deviations in this release.
- The Original Cost plugin is disabled as the server side calculation engine is no longer compatible.

### Fixed
- Admin interface cost config was never loaded, just used defaults.
- Feature card display for plan tasks was dependent of team selection. Now team selection is only a visual thing t o show allocation number on tasks.
  Team selections matter when using the expand filter for team allocation.
- Updated z-order of plugin and no tasks modal so fll screen plugins are not overlais by this modal.
- The new cost plugin only loads data for what is selected, making it much faster.

## [v2.0.8] - 2026-03-19

### Fixed
- Cache hit would return empty list of tasks if no tasks were changed since last cache hit.

## [v2.0.7] - 2026-03-18

### Added
- Dockerfile for deployment using docker.

### Fixed
- Work items are now returned in proper StackRank order (Azure backlog order) when using cached data. The fix ensures WIQL rank order is preserved when returning items from cache. Since Azure DevOps increments System.Rev when items are reordered, revision-based change detection automatically catches rank changes, and the system refetches affected items. Minimizes Azure API calls by only running lightweight WIQL queries for rank order and fetching full item details only for changed items.

## [v2.0.6] - 2026-03-17

### Fixed
- Details panel capacity input now properly updates when switching between feature cards. Fixed by using property binding (.value) instead of attribute binding (value) in the input element.

## [v2.0.5] - 2026-03-16

### Fixed
- Dependency overlay now updates immediately when the "Dependencies" expand toggle is changed in the sidebar. Added FilterEvents.CHANGED listener to DependencyRenderer.
- Expand filters (Parent/Child Links, Dependencies, Team Allocated) are now properly applied when loading a view. Previously, the checkboxes would show as checked but the filtering wouldn't be applied until the user clicked one of the filters. Fixed by syncing expansion state to State service, triggering data funnel recomputation, and emitting filter:changed event when restoring view options.

## [v2.0.4] - 2026-03-16

### Fixed
- View menu did not show save modal when saving a view. Refactored ViewSaveModal to use declarative Lit @click handlers instead of imperative querySelector + addEventListener pattern.
- Project and Team menus now always show all available options regardless of active view, allowing users to update views with new selections.

## [v2.0.3] - 2026-03-16

### Fixed
- MainGraph stayed blank when all plans were deselected but teams were selected with "Expand by Team Allocation" active. Fixed by introducing `State.getEffectiveSelectedProjectIds()` which derives the capacity-relevant project set from team-allocated features; both `recomputeCapacityMetrics` (State) and `buildSnapshot` (MainGraph) now use this method. `setExpansionState` also triggers a capacity recomputation when `expandTeamAllocated` changes. The `_fullRender` early-exit in MainGraph is now view-mode-aware (team mode checks team IDs; project mode checks project IDs) to avoid blanking in mixed-selection scenarios.

## [v2.0.2] - 2026-03-16

### Fixed
- Onboarding modal was not displaying. Fixed.

## [v2.0.1] - 2026-03-15

### Changed
- Removed redundant files from www/js/vendor . Lit bundle is built using Rollup and includes all dependencies.
- Admin interface for projects now adds included states to display states automatically.
- Retooling to use vite for testing instead of c8 and web-test-runner
- ViewManagementService now uses bulk selection functions for improved performance when switching views

## [v2.0.0] - 2026-03-14

The big two.oh.oh! This release brings a complete overhaul of the application user interface.

### Added

- Lit bundle generated and added to repo. Can be rebuilt using `npm run build:vendor`
  This removes dependency on esm.sh and makes the app load even faster.
- Projects Schema v3 which adds `display_states` field to project configuration.
  - Allows configuring which states are available for user selection in UI independently from fetched states
  - Enables use cases like allowing users to close tasks even when "closed" state is not fetched
  - Admin UI updated with separate editors for "States to Fetch" vs "States for UI Display"
  - Automatic migration from v2 configs (display_states defaults to include_states)
- Migration scripts to upgrade to new project scheme. Run with: `python3 scripts/migrate.py --apply`
- Added feedback in the history plugin to let the user know what is being processed
- Created completely new sidebar and top menu layout.  This eases the clutter and creates a whole new look and feel.
  - The filtering is much more powerful and intitive: A base set of tasks are selected with Plans.
  - Task pool is extended through simple buttons to include relations to the task pool
  - The application displays the total pool and currently displayed tasks.
- Added completely new help system. Documentation much improved and work in progress. No one is going to read it anyway.

### Changed
- Harmonised task state case handling. State case as returned from Azure Devops is now used throughout
  the application. This removes a lot of logic with upper/lower case handling
- State discovery inthe frontend is removed. Now it uses configured `display_states` from server.
- Modal for messaging the user when no cards are shown, updated to new design
- Removed tour functionality (Shepherd library, TourStarter.js, and all data-tour attributes). The guided tour is no longer needed with the refactored UI.
- Removed legacy keyboard shortcut handlers for view toggles (D/C/U/A/H) from the Sidebar; global shortcuts remain limited to app search (Ctrl+Shift+F).
- Improved actions UX for Scenarios and Views: replaced awkwardly positioned popover menu with inline action buttons (Update 💾, Rename ✏️, Delete 🗑️)
  that appear on hover over each item

### Fixed
- Fixed main area layout to respect sidebar width - added left margin so timeline-board and plugins render next to sidebar instead of underneath it
- Fixed sidebar scrolling: moved scroll behavior to content wrapper
- Fixed Sidepanel Top edge so it does not overlap then menubar
- Fixed Details panel Top edge so it does not overlap then menubar
- Optimized Plan Menu and Team Menu select/deselect all operations to use batch updates, reducing compute time from ~3110ms
  to near-instant by eliminating O(n) capacity recalculations
- Fix MIME error loding modules file in an unsupported way for newer browsers.
- Fixed timeline not centering on current month on initial load - timeline now centers on current month instead of left-aligning it,
  which was causing viewport to show months 5-6 months ahead

## [v1.15.1] - 2026-03-13

### Fixed

- HistoryPlugin did not use the improved session re-acquisition logic.


## [v1.15.0] - 2026-03-13

### Added

- TTL-based history caching with batch optimization. Before history retrieval would
  invalidate the entire server cache every 24 hours causing a full frefresh of all
  task history data. This optimisation batches revision calls checking for task updates
  when the cache TTL runs out every 24h and only refresh those items which changed.

### Changed

- Azure task cache optimization. The cache tracks per-work-item revisions using `System.Rev` field and
  only fetches changed items. This reduces API calls as full cache refresh on expiry is not needed.
  Task cache TTL is set to 30 minutes.

### Fixed

- Fixed `MemoryStorage.delete()` signature to match `StorageProtocol` interface (namespace, key parameters)

## [v1.14.3] - 2026-03-11

### Changed

- View Options section in Sidebar is now always visible (no longer collapsible)
- Commented out Plans, Allocations (Teams), Scenarios, Views, and Configuration & Help sections from Sidebar - all functionality now available via TopMenu
- Sidebar now only displays: View Options and Tools sections
- Re-acquiring a session is done in the background now. Only if a session could not be acquired will a
  message be displayed.
- Clicking a featurecard no longer contact the server to get iterations. Use internal state now.
- Details panel Iterations dropdown display iteration dates.
- Server /api/iterations endpoint will not return iterations withot dates or iterations where dates are earlier than
  the current year.
- Tasks with no dates set but an iteration will have dates set to the iteration dates when loading data from the server.
  This improves the user experience where iterations are used to set dates for a task without changing the
  start/end dates.
- Cost plugin default start date is now set to the current year.

### Fixed

- Fixed data binding for all menu components (PlanMenu, TeamMenu, ScenarioMenu, ViewMenu) - components now properly receive data as properties from TopMenu parent
- Fixed TopMenu initialization to call event handlers with current state, ensuring menus display data even when state loads before component connects
- Fixed menu components to rely on property binding from parent instead of initializing from state in connectedCallback
- got rid of stray } in tables rendered in PluginCostComponent.js

## [v1.14.2] - 2026-03-09

### Fixed

- Session reacquisition wiped unsaved scenarios because REST interface init loaded scenarios as sideeffect
  due to unclean design.

## [v1.14.1] - 2026-03-08

### Fixed

- Ghosted feature cards were missing the plan color accent
- Sizing of parents, where the chldren are in other plans allowed the parent to be smaller than
  the children last end date. Now a parent will not size smaller than their children regardless
  of the plan they come from.

## [v1.14.0] - 2026-03-06

### Added

- If the user session has expired (by server restart, or opening another browser session), the application will
  attempt to re-acquire a new session so the user can retry an action without loosing unsaved work.
  
### Changed

- Removed mix of light DOM and shadow DOM use and now only use shadow DOM. This paves the way to component independence.
- Full screen plugins now render alongside the timeline board. Before they were mixed in with the board causing confusion.

### Fixed

- The card border accent for the plan colors got lost, now it is back.
- Several plugins were missing a close button, and those with one did not unselect the tool chip in the sidebar.
- The history plugin only rendered bars for the tasks on screen, and then nothing else unless resizing the browser.
- Broken npm tests after refactoring fixed.

## [v1.13.2] - 2026-03-04

### Fixed

- Shortcut keys introduced with v1.13.0 were not working properly. Shortcuts removed until proper fix.

## [v1.13.1] - 2026-03-03

### Changed

- Change label on "Show Unassigned" to "Show Unallocated"
- Moved View zoom option "3 months" one spot left.

## [v1.13.0] - 2026-03-03

### Added

- The tool will display a helping modal when no tasks are displayed to give the user a hint of the reason why.
  Fixes [#1](https://github.com/kpoppel/PlannerTool/issues/1)
- In the details panel the user can change the state of a task. Use a scenario to persist a state change in Azure.
  Fixes [#4](https://github.com/kpoppel/PlannerTool/issues/4)
- Plan health check checks for orphaned tasks.  This is an opinionated check.  Tasks in a plan of type "project"
  are considered hierarchically higher than "team" plans.  All team plan tasks must have a project as parent.
  Otherwise it is considered an orphan. This might not be a problem, but it could be a sign it is not funded.
  Fixes [#12](https://github.com/kpoppel/PlannerTool/issues/12)
- Added vertical scrollbar. It appears on screen when moving the mouse close to the edge. Two buttons control
  scrolling to top and bottom in one click. Fixes [#14](https://github.com/kpoppel/PlannerTool/issues/14)
- Added a LayoutManager to avoid looking up geometry in the DOM. This speeds up board operations significantly
- Added keyboard shortcuts for selecting zoom range, and com of the button in View Options. Check the help.

### Changed

- Added behind featureflag PRESERVE_UNPLANNED_CHILDREN_ON_EPIC_MOVE a change which causes unplanned children to stay
  unplanned when moving a parent. It is enabled by default so the new behaviour is the default. Set to false in
  config.js to use the old behaviour where moving a parent also updates dates on its unplanned children.
  Fixes [#8](https://github.com/kpoppel/PlannerTool/issues/8)
- The details panel for a task now display which plan it belongs to.
  Fixes [#6](https://github.com/kpoppel/PlannerTool/issues/6)
- Details panel now displays the plan name for parent links if the parent is not in the same plan as the task.
  Fixes [#15](https://github.com/kpoppel/PlannerTool/issues/15)
- Updated test suite.

### Fixed

- Board rendering when selecting or deselecting plans was really slow. Reduced plan selection from 5 seconds
  to <1s on dev machine. In the process removed several 100 lines of code.
- Fix a console warning about Lit sourcemap
- Fix dependency vire setting not saved in a View. Fixes [#13](https://github.com/kpoppel/PlannerTool/issues/13)
- Fix for AnnotationPlugin where the toolbox started flashing when scrolling, and annotations scrolling at
  double speed.

## [v1.12.0] - 2026-03-03

- skipped


## [v1.11.0] - 2026-02-22

### Added

- Task History Plugin: New plugin that displays task date change history as an interactive timeline overlay. Shows start/end date changes with colored lines, dots, and fish-bone connectors for paired changes. Includes tooltips and keyboard accessibility.
- Backend API endpoint `/api/history/tasks` for fetching work item revision history from Azure DevOps.
- Azure work items module extended with `get_task_revision_history()` method to fetch revisions filtered to start/end/iteration changes.
- History service (`HistoryService`) with deduplication and pairing hint computation for efficient frontend rendering.
- Admin interface has button to reload the full config in Utilities.
- Added project capacity graphing of unfunded activities. This is a brown graph showing all capacity allocated which is not
  linked to a project (areapath designated as type=project in the configuration).
- Added Plan health tool plugin. This tool makes some checks on common planning issues and displays them in a modal.
- Cost tables are split int projects and teams. Teams can display cost with tasks funded by a project and unfunded (team only) tasks.
- Added new plugin: Task History. It will show the historical date changes of a task in the form of an interactive timeline overlay.
  Shows start/end date changes with colored lines, dots, and fish-bone connectors for paired changes. Includes tooltips.

### Changed

- Cost module uses a proper storage backend instead of a local file storage
- Ghost titles are more visually appealing when dragging a card: The title is hidden and displayed again when the card is dropped.
- Cost tables can be delimited by a date range.

### Fixed

- Cost module cache needed to be invalidated when data it relies on is changed.
- Fix project allocation roll-up is not calculated correctly. Epics with children are ignored.
- Fix Individual teams showed up as project graph.
- Reword Epic tooltip on how allocations are used when ithas children nodes.
- Fix multiple card renders on app load taking a long time.
- Improved load time of ghost titles. Still 750ms on card updates (hundreds of cards) on full board updates (first load and zoom change)

## [v1.10.0] - 2026-02-21

### Added

- For cards with a long title the tool will now display a "ghost title" next to the card
- Export plugin renders the ghost titles too (needs some refinement as this is a separate SVG rendering
  of the user interface)
- Admin backend has teams vs people database validation information added now to see if mappings are correct
- Added file storage backend for single file storage
- Backend service refactoring People handling into its own module. The cost module has option to configure people without
  using the database file.
- Admin now has interface for inspecting and overriding at people/team level and get reports of mismatches.

### Changed

- Cost module uses the new people service.
- Updated of schems for teams to change key to match database file and add in "exclude" key to get a clean setup when
  more teams or teams with name differences are in the database file. Info: The database file can be managed by an external
  tool (successfactors-chrome-addon)

### Fixed

- Help text typos.
- Cost service now actually uses the database_path. Note: the path MUST include the filename now.

## [v1.9.0] - 2026-02-19

### Added

- Added use of project configuration for task type and states when retrieving tasks. Admins must invalidate the cache
  or wait for aging out to see the changes.
- Admin project configuration schema now dynamically retrieves work item types and states from Azure DevOps instead of
  using hardcoded values. The available options in the UI are now based on the actual work item types and states
  configured in your Azure DevOps project.
- Added views feature: Users can now save and restore UI configurations (views) including selected projects, teams, 
  and view options. Views are persisted to the backend similar to scenarios. 
  - Backend infrastructure: new `planner_lib/views/` module with view storage and REST API endpoints
  - Frontend: new "Views" section in sidebar with save/load/delete functionality
  - Views capture: selected projects, selected teams, timeline scale, capacity mode, filters, and display options
  - View actions: save new view, load existing view, update view, rename view, delete view
  - Views are user-scoped and stored with metadata (id, user, name)
- Added new filter type for project type plans: Show only Project hierachy allows filtering out on teams so that only team
  tasks which are linked to the selected project(s) are displayed. This hides any tasks from teams which are not related to
  a displayed project.

### Changed
### Fixed

## [v1.8.0] - 2026-02-18

### Added

- Added admin module for utilities: Clearing and invalidating the task cache

### Changed

- When pressing the "Refresh Baseline" button in the sidebar the server invalidates the task cache before refreshing so
  changes are immediately visible in the task list

### Fixed

- Cache TTL was not respected. Migration script added to remove cache and start over.

## [v1.7.0] - 2026-02-17

### Added
### Changed

- Admin UI project setup page made better and more compact

### Fixed

- Features without included parent Epic were silently dropped


## [v1.6.0] - 2026-02-06

### Added

- Added initial support for iterations. Iteration are timeboxes as an extra layer from delivery plans, whereas
  start and end date according to Azure lore is more specific than an iteration, i.e. when within an iteration something
  begins and ends. This version use the dates from an iteration to set start end end dates and does not annotate
  a used iteration selection back to Azure.

### Changed

- Documentation updates: example configuration files, architecture descriptions, readme file.

### Fixed

- Server bootstrapping from "cold start" without any configuration did not work
- Iterations endpoint sent non-valid JSON object to server
- When updating system config, server did not update Azure endpoint

## [v1.5.1] - 2026-02-03

### Fixed

- Fix area to plan mapping did not work with caching client.

## [1.5.0]  - 2026-02-02

### Added

- Delivery plan markers plugin. The plugin will de-duplicate markers attached to several team/area_paths.
  It will also filter on the same project selection as the rest onf the UI. Additionaly there is a toolbox
  allowing to display markers based on their color setting.
- More tests on the server side to improve coverage
- Add feature to retrieve delivery plan markers in backend
- Add admin UI for project to plan ID mappings.
- Improved admin backend to use a schema-driven interface generation.
- Added cost schema to backend

### Changed

- Remove plugins map from server_config.yml it was not used.
- Refactor of the Azure Client to improve testability and shared code.
  Structurally eliminate PAT bleeding between user sessions.

### Fixed

## [1.4.1]  - 2026-01-27

### Fixed

- Fixed systemd runner script to use uvicorn factory runner


## [1.4.0] - 2026-01-27

### Added

- Improved onboarding flow now opens the config modal as part of the flow.
- Add development server app using memory-based storages.
- Added fields to proejct configuration: states to include, task types to include
- Added simple admin interface. Now possible to edit teams, projects,
  server configurations and manage users. Very rudimentary.

### Changed

- Tour includes details panel. Some information updates for new users.
- Internally all onboarding is delegated to the TourStarter.
- Internal refactoring to a more composable architecture. Main program now much easier to follow what happens.
- Storage abstracted so different backends can be pushed in without affecting the application
- /api/config -> /api/account
- Internal refactoring to bring cost package to CostService like the other services
- Made CostService use storage package instead of loading files directly
- Several migrations to split configuration files by concern (teams, projects, system), and database file ending->yml
- Upgrade projects schema to 2 to add fields for future expansion for task types and states to import.

### Fixed

## [1.3.0] - 2025-01-20

### Added

- Add a small divider line between project and team type plans and sorted the two groups.

### Changed

- Featurecards now dim capacity fields and add an information icon explaining the capacity on cards with children is ignored when there are children.
  Is was always like this, so this is just to make the paradigm clear: If a card has children we assume estimates are one step more accurate.
- server_config updated to include type of the area path: project|team

### Fixed

- Search field needed to have focus and text selected on open.
- Project capacity allocation computes in areas paths designated as type 'project'. Before project capacity was calculated on any area path,
  and as such also on area paths which are team backlogs.

## [1.2.0] - 2025-01-19

### Added

- Add migration script in scripts/migrate. When schemas for file formats are changed make upgrades safely
- Add schema version field in saved files.
- Add server_name in config. This value shows up in the sidebar footer. Value published through /api/health
- Add new search feature. Activate using ctrl+shift+f

### Changed

- systemd_runner.sh now runs migrations and installs pip dependencies.
- Migrate accounts from config directory to accounts

### Fixed

- Azure caching tests updated to accept new per-area cache invalidation.

## [v1.1.1] - 2025-01-19

### Fixed
 
- Crash. The Azure Client code now reacts nicely when configured area paths cannot be found due to deletion or rename in Azure Devops.

## [v1.1.0] - 2026-01-18

### Changed

- Faster loading by not loading data from serer twice from UI on firs open Cost plugin.
- Improve caching about 10x speedup 2026-01-19

### Fixed

- Scenario endpoint had context gone missing after refactoring

## [v1.0.0] - 2026-01-18

### Changed

- Simplify session management by using `session_manager.get_val` for user context retrieval (8c5a80a) 2026-01-18 kpoppel
- Add generated changelog and update tags/HEAD (c524608) 2026-01-18 kpoppel

### Fixed

- Rename tags to v-prefixed names and update changelog headings (68b7563) 2026-01-18 kpoppel

---

## [v0.16.0] - 2026-01-18

### Added

- Add application icon to UI (2f34d6f) 2026-01-16 kpoppel
- Report version in server health endpoint (836c3fb) 2026-01-17 kpoppel
- Add bump/version script for releases (f428780) 2026-01-17 kpoppel
- Add comprehensive end-to-end tests and fix scenario cloning to include overrides (25c9ddc) 2026-01-18 kpoppel
- Refactor Azure clients for deferred connection/session management (2f1add9) 2026-01-18 kpoppel

### Changed

- Grey out Save-to-Azure button when no overrides present (b0b227b) 2026-01-16 kpoppel
- Improve test coverage and related tests (6587edf) 2026-01-16 kpoppel
- Update task list/README entries (b7861c6) 2026-01-16 kpoppel

### Fixed

- Fix sidebar save-dialog activation based on scenario overrides (c43421f) 2026-01-16 kpoppel
- Update failing test and adjust assertions (60d6db4) 2026-01-16 kpoppel

### Deprecated

- Mark Azure client refactor as deprecating prior connection strategies (2f1add9) 2026-01-18 kpoppel

### Removed

- Remove older Azure connection/session implementations in favour of refactored clients (2f1add9) 2026-01-18 kpoppel

---

## [v0.15.0] - 2026-01-13

### Added

- Ensure consistent font-family for SVG text in exports (8b27007) 2026-01-11 kpoppel
- Improve annotation rendering for exports and add icon annotation support (be1f49e) 2026-01-11 kpoppel
- Add SVG/PNG save and copy-to-clipboard support in export tool; move toolbox UI (4d82fce) 2026-01-11 kpoppel
- Add auto-close message modal for export notifications (af2d676) 2026-01-11 kpoppel
- Rename sidebar sections for clarity and update planning terminology (1e8d3a2, 0fba2fd) 2026-01-12 kpoppel
- Add onboarding modal and guided tour integration (b54724c, 7a8993f) 2026-01-12 kpoppel

### Fixed

- Improve export error messages and config flag naming consistency (85508dd, 9d053ff) 2026-01-12..13 kpoppel

---

## [v0.14.0] - 2026-01-11

### Added

- Refactor timeline and introduce `TimelineBoard` component (b61bed1) 2026-01-10 kpoppel
- Enable annotations plugin and update export pipeline (f2918a8) 2026-01-10 kpoppel
- Enhance plugin activation logic to support exclusive configurations (4ff9880) 2026-01-10 kpoppel
- Improve annotation overlay panning and icon annotation tools (ba8d6f8, 80c6f0b) 2026-01-11 kpoppel
- Adjust month label rendering for year-scale to prevent wrapping (8230f98) 2026-01-11 kpoppel

### Changed

- Refactor FeatureBoard imports and add render logging (ffa20c3) 2026-01-10 kpoppel

### Fixed

- Fix details panel opening during drag/resize interactions (b8f10f8) 2026-01-10 kpoppel

### Removed

- Removed duplicate plugin close buttons from plugin components (8a71efe) 2026-01-10 kpoppel

---

## [v0.13.0] - 2026-01-10

### Added

- Improve sidebar restoration and reactive handling for projects/teams/scenarios (6c089ee, 3b78905) 2026-01-09 kpoppel
- Add three-month timeline scale and debounced resize handling (741b369, d9df5a0) 2026-01-09 kpoppel
- Implement annotation state, storage and UI primitives for export annotations (9400468) 2026-01-10 kpoppel
- Add vendor scripts and icon support for timeline export (aadb5a4) 2026-01-10 kpoppel
- Add feature icon display in details panel header (6945494) 2026-01-10 kpoppel

### Changed

- Add experimental export plugin (d884532) 2026-01-10 kpoppel

### Fixed

- Cache aggregated counts in FeatureService and improve count performance (e9e7be0) 2026-01-09 kpoppel
- Fix UTC-related bug when moving cards on certain dates (89eb4cb) 2026-01-10 kpoppel

### Removed

- Internal annotation alpha entry removed from this release cycle (9400468) 2026-01-10 kpoppel

---

## [v0.12.0] - 2026-01-08

### Added

- Implement work-item cache invalidation and update handling in `AzureCachingClient` (d09f867) 2026-01-04 kpoppel
- Add capacity management features across UI and cost components (698a35d) 2026-01-04 kpoppel
- Refactor `QueuedFeatureService` to better handle updates and epic relationships (c0587ea) 2026-01-05 kpoppel
- Add budget deviation tracking and controls to cost component (6d4a55b) 2026-01-06 kpoppel
- Add config files and path resolution helpers for cost/database settings (839c310) 2026-01-07 kpoppel
- Sanitize team capacity blocks when short names change (2dc2d77) 2026-01-07 kpoppel
- Add timeline zoom controls with segmented control UI (bc25541) 2026-01-07 kpoppel

### Changed

- Refactor tests and services for improved coverage and reliability (fe23d0f) 2026-01-08 kpoppel

### Fixed

- Fix feature card overflow and improve text handling (88c1748) 2026-01-04 kpoppel

---

## [v0.11.0] - 2026-01-04

### Added

- Add `MUTE_ZERO_CELLS` flag and improve zero-value handling in cost plugin (1127a05) 2025-12-31 kpoppel
- Make task state filter additive and update cost estimation docs (7b79e74) 2026-01-04 kpoppel
- Add server-side readonly scenario validation and related integrations (afd9314) 2026-01-04 kpoppel
- Introduce dedicated services for color, config and view responsibilities (1cbb98b) 2026-01-04 kpoppel
- Add `StateFilterService` and capacity update APIs for tasks (af36e71, 88d4b7c) 2026-01-04 kpoppel
- Improve feature and scenario management services (fcea44a) 2026-01-04 kpoppel

### Changed

- Refactor SpinnerModal and Timeline components; modernize FeatureCardLit usage (2a67232, 1af57a4) 2025-12-31 kpoppel

### Fixed

- Fix README formatting in cost estimation docs (6901e4e) 2026-01-04 kpoppel

---

## [v0.10.0] - 2025-12-30

### Added

- Add tests for day-overlap distribution and refactor cost engine calculations (cce4739, 96eb9e7) 2025-12-30 kpoppel
- Refactor `PluginCostCalculator` and related helpers for clarity and accuracy (f146dfd, c3ccd7f) 2025-12-30 kpoppel
- Update tests for ServiceRegistry logging and remove deprecated string event subscriptions (6408248) 2025-12-30 kpoppel
- Expand unit/integration tests and improve documentation for core modules (6da40e8, bb92ed4, 299f5c5, afd2781) 2025-12-30 kpoppel

### Deprecated

- Deprecated older string-based event subscriptions in tests (6408248) 2025-12-30 kpoppel

### Removed

- Removed deprecated test subscriptions and adjusted tests accordingly (6408248) 2025-12-30 kpoppel

---

## [v0.9.0] - 2025-12-30

### Added

- Update plugin metadata and loading logic (ebdc92f) 2025-12-26 kpoppel
- Add accent color support and state color mapping for chips (1122b0c) 2025-12-26 kpoppel
- Improve feature state management and integrate cost data pipelines (2339336) 2025-12-27 kpoppel
- Implement `getCost` API and scenario-aware cost retrieval with debounce (0f50d5e, e265580) 2025-12-27 kpoppel
- Add cost teams UI and data retrieval support (9ac0e60) 2025-12-27 kpoppel
- Integrate epic capacity handling and enhance cost calculation logic (f588fd9) 2025-12-30 kpoppel
- Styling and tests for cost engine and distribution (0d90e0c, ec3a77a, d016901) 2025-12-30 kpoppel

---

## [v0.8.0] - 2025-12-26

### Added

- Improve dependency renderer to collect renderers across shadow roots (7536cba) 2025-12-26 kpoppel
- Add double-click revert on FeatureCard and live date updates during drag/resize (84bd2b1, 3267a24) 2025-12-26 kpoppel
- Enable incremental capacity recalculation and optimize card updates/event emissions (9f9c697, 563b79e) 2025-12-26 kpoppel
- Introduce plugin system and Graph View plugin; refactor plugin registration to use `enabled` flag (9eac226, 5e5a633) 2025-12-26 kpoppel
- Enhance test coverage for FeatureBoard and State services (ea48563) 2025-12-26 kpoppel

### Changed

- Simplify SVG handling and DependencyRenderer internals (e9ea6cd, e8fb4d1) 2025-12-26 kpoppel

### Removed

- (internal) plugin registration moved to `enabled` flags; in-repo registration removed (5e5a633) 2025-12-26 kpoppel

---

## [v0.7.0] - 2025-12-26

### Added

- Add Brotli compression middleware (feature-flagged) (5bb1939) 2025-12-23 kpoppel
- Migrate board and cards to Lit components; add typed event system and improve performance (d25724c, 3bb61ab) 2025-12-25..26 kpoppel

### Changed

- Large architecture-v2 rebase/merge and reorganisation across tests and components (9d27693, 16473dc) 2025-12-22..23 kpoppel
- Various refactors: remove unused properties, tidy event listener registration, and adopt symbol-based events for type safety (8bb0f90, 39f6d21, bc386af, 75c57cd) 2025-12-25..26 kpoppel

### Fixed

- Fix DependencyRenderer SVG overlay and related tests (1b05fb3) 2025-12-26 kpoppel

### Removed

- Remove unused `inScenarioMode` property and related code (8bb0f90) 2025-12-25 kpoppel

---

## [v0.6.0] - 2025-12-23

### Added

- Enhance feature card styling and icon classes (f1704b4) 2025-12-19 kpoppel
- Add Azure DevOps usage guidelines and backend logging features (a33fb3b, ea08e10) 2025-12-19..23 kpoppel
- Introduce `AzureCachingClient` and `AzureNativeClient` implementations and file-based caching to reduce Azure requests (83ec8a8, 886bf11) 2025-12-23 kpoppel
- Improved cache operation logging (2b4baa9) 2025-12-23 kpoppel

### Changed

- Remove legacy `refreshBaseline` methods and simplify state fetching (6731054) 2025-12-19 kpoppel
- Update backend test configuration and improve data handling in tests (348b04f) 2025-12-22 kpoppel
- Adjust logging levels and cache handling in tests (b3c6522) 2025-12-23 kpoppel

### Removed

- Removed legacy `refreshBaseline` implementation(s) (6731054) 2025-12-19 kpoppel

---

## [v0.5.0] - 2025-12-18

### Added

- Add scenario persistence: save/load scenarios to backend storage (2b28622) 2025-12-08 kpoppel

### Changed

- Refactor sidebar configuration markup and styles for clarity (2d48454, a8a3151) 2025-12-07 kpoppel
- Refactor capacity handling across project management and cost modules (a0b7cd1) 2025-12-17 kpoppel

### Fixed

- Fix graphs for teams rendering and mountain view issues (e380efc) 2025-12-07 kpoppel
- Update help text and parsing terminology from "Team Loads" to "Team Capacity" (024034c, 160b425) 2025-12-07 kpoppel
- Documentation typo fixes and README improvements (a950474) 2025-12-07 kpoppel
- Rendering fixes to respect selected teams/projects in graphs (34c58b0) 2025-12-07 kpoppel
- Fix state management and event handling regressions (cab06e9) 2025-12-18 kpoppel

---

## [v0.4.0] - 2025-12-07

### Added

- Add loading modal with spinner and improved UX (8937978) 2025-12-06 kpoppel
- Enhance sidebar with collapsible sections and improved selection UX (c9e3543) 2025-12-06 kpoppel
- Improve API URL -> UI link extraction and mapping (a5e2c29) 2025-12-06 kpoppel
- Add task update API and refactor save modal flow (c9e17df) 2025-12-06 kpoppel
- Add team load parsing and mapping helpers (1f1a20f) 2025-12-06 kpoppel
- Improve Azure client type/date handling and relations mapping (7bfb31b) 2025-12-07 kpoppel
- Add chip-based view options and state filtering UI (578f153) 2025-12-07 kpoppel
- Add mountain view modal and capacity selector (4dd0485) 2025-12-07 kpoppel
- Add systemd service and runner script for backend deployment (14ab508) 2025-12-07 kpoppel

---

## [v0.3.0] - 2025-12-05

### Added

- Add REST health endpoint and basic server plumbing (2345952) 2025-12-02 kpoppel
- Add configuration management with file-backed storage (08362a6) 2025-12-03 kpoppel
- Add project and team filtering and Azure organization handling improvements (317670e) 2025-12-05 kpoppel
- Add counts and layout improvements for projects/teams in the sidebar (39c11fd) 2025-12-05 kpoppel
- Improve team listing and mock team load support (8483cd3) 2025-12-05 kpoppel
- Optimize Azure work item retrieval via batching (17421e2) 2025-12-05 kpoppel
- Refactor feature date updates for bulk operations (5089e83) 2025-12-05 kpoppel
- Add sidebar toggles for selecting all projects/teams (7eb61f7) 2025-12-05 kpoppel

### Changed

- Major backend and feature additions; REST backend expanded (130002b) 2025-12-03 kpoppel

### Fixed

- Fix: use `TargetDate` for work item finish dates (0e8492e) 2025-12-05 kpoppel

---

## [v0.2.0] - 2025-12-02

### Added

- Add logging for provider methods and refactor color initialization in State (86646e4) 2025-12-01 kpoppel
- Add help modal and dependency-rendering support (f4e5f00) 2025-12-02 kpoppel
- Add dependency rendering helper and docs (f0fdcd9) 2025-12-02 kpoppel
- Add REST health endpoint and UI wiring (d50dfa7) 2025-12-02 kpoppel

### Changed

- Move color localStorage handling into centralized data service/provider (1a51e1d) 2025-12-01 kpoppel
- Calculate organisation load on refresh using updated logic (a72b97c) 2025-12-01 kpoppel
- Centralize timeline configuration and improve org-load computation (08eb111) 2025-12-02 kpoppel

### Fixed

- Fix epic end-date calculation to consider baseline and overrides together (1a8450a) 2025-12-01 kpoppel
- Layout fixes for feature-board overflow and background alignment (ebc10c9) 2025-12-02 kpoppel
- Update orgLoad computation to use instance method reliably (4f53b06) 2025-12-02 kpoppel

---

## [v0.1.0] - 2025-11-30

### Added

- First major commit of the PlannerTool: initial UI, mocked backend, configuration dialog, and scenario planning (16a7d61) 2025-11-30 kpoppel
- Add frontend test suite (7f5e7e9) 2025-11-30 kpoppel

### Changed

- Initial repository scaffold (ec765f1) 2025-11-30 kpoppel
- Add .gitignore to exclude unnecessary files (aa07ac8) 2025-11-30 kpoppel
- Add scenario cloning functionality (8f48ece) 2025-11-30 kpoppel
- Refactor: simplified publishBaseline and related scenario sync behavior (35ae590) 2025-11-30 kpoppel
- Move state to a class-based implementation for clearer lifecycle handling (37540ee) 2025-11-30 kpoppel
- Refactor: introduce baseline data structures and improve scenario handling (cd29913) 2025-11-30 kpoppel
- Remove legacy persistScenarioOverrides provider method (bd5a312) 2025-11-30 kpoppel
- Add README and getting-started documentation (805b655) 2025-11-30 kpoppel

### Removed

- Removed legacy provider method `persistScenarioOverrides` (bd5a312) 2025-11-30 kpoppel

---
