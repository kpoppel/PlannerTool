# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project should strive to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Template:

## [v] - date

### Added
### Changed
### Fixed

---
## [v]  - unreleased

### Added
### Changed
### Fixed


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
