# System Architecture & Design: Schema-Driven Admin Configuration UI

## 1. Executive Summary & Mental Model

**High-Level Purpose:** PlannerTool has many independently-editable configuration domains (server settings, Azure DevOps connection, projects, teams, people, cost rates, event backend, plugin runtime config). Rather than building a bespoke hand-coded form for each one, the backend publishes a **JSON Schema description of the shape of each config object**, and a single generic frontend component (`SchemaForm`) renders, edits, and validates *any* config object purely by walking that schema. This avoids N one-off editors and keeps the "what fields exist / what are their types and constraints" definition in exactly one place: the backend schema registry.

**The Core Metaphor:** Think of it as a **metadata-driven form compiler**. The backend hands the frontend a *blueprint* (JSON Schema) describing a data shape; the frontend is a generic interpreter that turns any blueprint into editable HTML. The blueprint and the data travel as two separate payloads over two separate endpoints — `GET /admin/v1/schema/{config_type}` for the shape, `GET/POST /admin/v1/{config_type}` for the actual values. Saving is a raw JSON `POST` of the edited data; **the schema is not re-validated by the server** — it is a UI-generation and client-side-validation contract only, not a backend enforcement contract.

## 2. System Components & Boundary Map

### Directory & File Layout

```
planner_lib/admin/
  schema.py            # Static JSON Schema registry (source of truth for shapes)
  config_routes.py      # FastAPI routes: GET schema, GET/POST config content
  config_manager.py      # ConfigManager: load/save + timestamped backups (no schema validation)
  plugin_runtime_config.py # Ad-hoc normalization for one config type (schema_version bump, not JSON-Schema based)
planner_lib/backend/
  registry.py           # get_ado_schema() / get_merged_schema() — schema built dynamically from registered backends

www/admin/js/
  components/SchemaForm.lit.js         # Generic schema-interpreting form renderer + client-side validator
  components/admin/BaseConfigComponent.lit.js  # Per-config-type page: loads schema+data, wires SchemaForm, Save/Reload/Raw-JSON toggle
  components/admin/{Teams,Projects,System,Cost,...}.lit.js  # Thin subclasses of BaseConfigComponent (just declare configType/title/defaultContent)
  core/pluginSchemaRegistry.js         # Discovers schemas contributed by plugins (`Plugin.getAdminConfigSchema()`)
  services/providerREST.js             # adminProvider — thin fetch wrapper: getSchema(type), get{Type}(), save{Type}(data)
```

- **Where shapes are defined:** `planner_lib/admin/schema.py` (`_SCHEMAS` dict) for static domains, plus `planner_lib/backend/registry.py:get_ado_schema()` for the one dynamically-assembled schema (Azure DevOps backend flags, merged from every registered backend's `config_schema()` classmethod).
- **Where the boundary sits:** the HTTP contract at `/admin/v1/schema/{config_type}` and `/admin/v1/{config_type}` is the seam between backend-owned shape/data and frontend-owned rendering.

### Key Abstractions

| Abstraction | Responsibility |
|---|---|
| `admin_schema.get_schema(config_type)` | Return a deep-copied static JSON Schema dict for a config type, or `None` if unknown (→ 404). Special-cases `'ado'` (dynamic) and `'events_config'`/`'system'` (static but requires explicit key routing). |
| `admin_schema.enrich_projects_schema(...)` | Best-effort, in-place mutation of the `projects` schema to inject live Azure DevOps work-item types/states as `enum` values, using the caller's PAT. Silently no-ops on any failure — the static schema is always a valid fallback. |
| `get_ado_schema()` / `get_merged_schema()` (`backend/registry.py`) | Builds the `ado` schema's `feature_flags` sub-schema by merging `config_schema()` from every registered backend class, so a new backend (e.g. Jira) automatically contributes its own flags without editing `schema.py`. |
| `ConfigManager` (`config_manager.py`) | Pure storage CRUD: `get_config`/`save_config` against the diskcache `config` namespace, with automatic timestamped backup of the previous value (gated by the `manage_backup_snapshots` feature flag). **Has no awareness of JSON Schema** — it persists whatever dict/string it is given. |
| `SchemaForm` (Lit component) | Generic recursive renderer: walks `schema.properties`, dispatches per JSON Schema `type` (`string`, `number`/`integer`, `boolean`, `enum`, `object`, `array`, `patternProperties`) to a field-renderer, tracks edits into a plain data object via dotted/bracket path parsing (`_updateValue`), and implements `validate()` (required/minLength/minimum/type checks) and `getData()` (recursively fills in schema `default`s for untouched keys). |
| `BaseConfigComponent` (Lit component) | Per-config-type page shell. Fetches schema + content in parallel on connect, renders `<schema-form>` (or a raw-JSON textarea toggle), and on Save calls `form.validate()` → `form.getData()` → `adminProvider.save{ConfigType}(data)`. Subclasses (`Teams`, `Projects`, `System`, `Cost`, ...) only override `configType`, `title`, `defaultContent`. |
| `pluginSchemaRegistry.js` | Parallel, plugin-contributed schema path: calls `Plugin.getAdminConfigSchema()`/`getDefaultAdminConfig()` (static methods a plugin class may implement) so plugin config panels use the same `SchemaForm` renderer without the backend needing a static registry entry. |

## 3. Data Flow & Integration Patterns

### Primary Execution Path (viewing/editing a config panel, e.g. Teams)

```mermaid
sequenceDiagram
    participant UI as AdminTeams (BaseConfigComponent)
    participant API as FastAPI (config_routes.py)
    participant SchemaMod as admin_schema.py / registry.py
    participant CM as ConfigManager
    participant DB as diskcache ("config" namespace)

    UI->>API: GET /admin/v1/schema/teams
    API->>SchemaMod: get_schema('teams')
    SchemaMod-->>API: deep-copied JSON Schema dict
    API-->>UI: 200 schema JSON

    UI->>API: GET /admin/v1/teams
    API->>CM: get_config('teams')
    CM->>DB: load('config','teams')
    DB-->>CM: raw dict/string
    CM-->>API: value
    API-->>UI: {content: value}

    UI->>UI: SchemaForm renders fields from schema, bound to content
    Note over UI: user edits fields; _updateValue() mutates local data by path

    UI->>UI: Save clicked -> form.validate() (client-side only)
    UI->>UI: form.getData() (fills in schema defaults for missing keys)
    UI->>API: POST /admin/v1/teams {content: editedData}
    API->>CM: save_config('teams', content)
    CM->>DB: backup existing 'teams' (if manage_backup_snapshots flag on)
    CM->>DB: save('config','teams', content)
    API-->>UI: {ok: true}
```

1. **Schema fetch:** `GET /admin/v1/schema/{config_type}` → `admin_get_schema()` in `config_routes.py` → `admin_schema.get_schema()`. For `projects`, the route additionally calls `enrich_projects_schema()` using the caller's Azure PAT (from the session) to inject live work-item type/state enums — this is the one place schema content depends on runtime/session state rather than being purely static.
2. **Data fetch:** `GET /admin/v1/{config_type}` reads the raw config value via `AdminService`/`ConfigManager` from diskcache. The two payloads (schema, data) are unrelated HTTP round-trips fetched in parallel by `BaseConfigComponent.loadConfig()`.
3. **Render:** `SchemaForm` receives both as Lit properties and recursively renders. Arrays render as repeatable "array item" blocks with add/remove/drag-reorder controls; objects render as nested bordered sections; `patternProperties` (e.g. `cost.working_hours` keyed by site code) render as dynamic key/value rows.
4. **Edit tracking:** every input's change handler calls `_updateValue(path, value)`, which parses a path like `project_map[0].task_types` into property/index tokens and mutates the live `this.data` object in place (no diffing/patching — the whole object is the state).
5. **Validate + Save:** `BaseConfigComponent.saveConfig()` calls `form.validate()` (schema-shape checks, **client-side only**) then `form.getData()` (backfills defaults) and POSTs the whole object as `{content: ...}` to `/admin/v1/{config_type}`.
6. **Persist:** the route handler delegates straight to `AdminService.save_config()` → `ConfigManager.save_config()`, which writes a timestamped backup of the old value (only if the `manage_backup_snapshots` feature flag is set) and overwrites the canonical key in the `config` diskcache namespace. **No JSON Schema (or any other) validation happens server-side** — whatever the client POSTs is persisted verbatim (a few routes, e.g. `teams`, additionally invalidate a derived cache like `cost_service` on success).

### State Management & Storage

- **Schema definitions:** in-process Python dict literals (`_SCHEMAS`) plus one dynamically-computed schema (`ado`) assembled from backend classes at request time — no schema is ever persisted to disk; it's regenerated on every `GET /admin/v1/schema/...` call.
- **Config data:** diskcache, `config` namespace, one key per domain (`teams`, `projects`, `people`, `cost_config` alias `cost`, `server_config` alias `system`, `ado_config` alias `ado`, `plugin_runtime_config`, `area_plan_map`, `iterations`). Backups live in the same namespace as `{key}_backup_{ISO8601 timestamp}` entries.
- **Frontend state:** entirely client-local, held in `BaseConfigComponent.content` / `SchemaForm.data` as plain JS objects; there is no client-side cache layer — a page reload always re-fetches schema + data.

### Side Effects

- Saving `teams` invalidates `cost_service`'s cache (derived cost calculations depend on team membership).
- `restore_backup` (full-system restore) triggers `admin_service.reload_config()`, which reloads all in-memory config-derived services after a restore.
- `enrich_projects_schema` performs a live Azure DevOps API call (via the caller's PAT) on every `GET /admin/v1/schema/projects` — this is a per-request network call, not cached, and swallows all exceptions.

## 4. Architectural Decisions & Trade-offs

- **Schema-as-metadata, not schema-as-contract:** the design deliberately treats JSON Schema as a *UI generation and client-hint* format (types, titles, descriptions, enums, defaults) rather than a strict validation contract. This is a **Metadata-Driven UI** pattern (similar in spirit to JSON-Schema-Form libraries), chosen to eliminate per-domain hand-written forms and keep field definitions in one Python module instead of duplicated across N Lit components.
- **No server-side schema enforcement (intentional trade-off):** `ConfigManager.save_config()` persists whatever the client sends. This prioritizes flexibility (raw-JSON edit mode is a first-class feature in `BaseConfigComponent` — the "📝 Raw JSON" toggle bypasses `SchemaForm` entirely) over strict data integrity. Correctness currently relies entirely on the trusted admin-only caller and client-side `validate()`.
- **Dynamic schema composition for extensibility (Strategy-like registry):** `get_ado_schema()` merges `config_schema()` contributed by every registered backend class (`_priority_backends()`), so adding a new backend automatically extends the `ado.feature_flags` schema with zero changes to `schema.py`. The same pattern repeats on the frontend via `pluginSchemaRegistry.discoverPluginSchemas()`, which calls a `getAdminConfigSchema()` static hook on plugin classes.
- **`schema_version` fields, not schema evolution machinery:** several schemas (`projects`, `teams`, `people`, `cost`) carry an explicit `schema_version` integer property, but there is no generic migration engine tied to it in this layer (contrast with `plugin_runtime_config.py`, which does its own ad-hoc version-bump normalization). Version numbers are effectively documentation/markers for humans and for domain-specific normalization code elsewhere.
- **One generic renderer vs. many specialized ones:** `SchemaForm` handles the common JSON Schema vocabulary (`type`, `enum`, `properties`, `items`, `patternProperties`, `required`, `minLength`, `minimum`, `default`, `readOnly`) but not the full JSON Schema spec (no `oneOf`/`anyOf`/`$ref`/conditional schemas). This bounds what config shapes are expressible without extending the renderer.

## 5. Contributor Guide & Operational Hazards

### Extension Points

- **Add a new static admin config domain:**
  1. Add an entry to `_SCHEMAS` in `planner_lib/admin/schema.py` (or extend `get_schema()`'s special-casing if the type needs dynamic enrichment).
  2. Add `GET`/`POST /admin/v1/{config_type}` routes in `config_routes.py` delegating to `AdminService`/`ConfigManager`.
  3. Add `get{Type}`/`save{Type}` methods to `adminProvider` (`www/admin/js/services/providerREST.js`).
  4. Create a thin subclass of `BaseConfigComponent` (see `Teams.lit.js` for the minimal pattern: override `configType`, `title`, `defaultContent`) and register it as a custom element.
- **Add a new backend's feature flags to the ADO schema:** implement a `config_schema()` classmethod on the backend class returning a dict of property definitions; it is automatically merged by `get_merged_schema()` — no edits to `schema.py` needed.
- **Add a plugin-contributed config panel:** implement static `getAdminConfigSchema()` (and optionally `getDefaultAdminConfig()`) on the plugin class; `pluginSchemaRegistry.discoverPluginSchemas()` picks it up for the same `SchemaForm` rendering path used by static domains.
- **Enrich a schema with live data** (like `projects`' work-item types): follow the `enrich_projects_schema()` pattern — mutate the schema dict in place, wrap all external calls in a broad `try/except` so a static, valid schema is always returned on failure.

### Known Sharp Edges

- **No backend schema validation:** anything POSTed to `/admin/v1/{config_type}` is written to diskcache as-is. The "Raw JSON" toggle in `BaseConfigComponent` lets an admin bypass `SchemaForm` entirely and submit hand-edited JSON with no shape checking at all on either tier beyond `JSON.parse` succeeding. Do not assume config read back from storage matches its schema.
- **Schema is regenerated per-request, not cached:** every `GET /admin/v1/schema/projects` call can trigger a live Azure DevOps API round-trip (`enrich_projects_schema`). Under load or with a slow/unreachable Azure endpoint this adds latency to schema loads (though failures are swallowed, not surfaced).
- **`getData()` silently backfills schema defaults:** `SchemaForm.getData()` recursively injects `default` values for any key not already present in the data — this means saving a form can introduce previously-absent keys purely because the schema declares a default, which can surprise consumers expecting "what the user actually touched."
- **Path parsing in `_updateValue` is hand-rolled:** the `path` string parser (bracket/dot notation) has no bounds/quoting handling; nested arrays-of-arrays or property names containing `.`/`[`/`]` are not supported.
- **`config_type` → storage key aliasing is implicit:** the HTTP route segment (`system`, `ado`, `events_config`) does not always match the diskcache key (`server_config`, `ado_config`) or the `_SCHEMAS` dict key — the mapping lives in scattered `if config_type == '...':` branches in `get_schema()` and in the individual route handlers. When adding a new type, verify the aliasing consistently across `schema.py`, `config_routes.py`, and `ConfigManager.CONFIG_KEYS`.
- **Backups are opt-in and easy to forget are disabled by default:** `ConfigManager.save_config()` only writes a timestamped backup when the `manage_backup_snapshots` feature flag (in `server_config.feature_flags`) is truthy. With it off (the default), saving overwrites the previous value with no recovery path other than the full-system `/admin/v1/backup` snapshot.

### Testing Strategy

- **Backend:** unit-test `admin_schema.get_schema()` for each config type (shape presence, required special-casing of `'ado'`/`'system'`/`'events_config'`), and `enrich_projects_schema()` with mocked `azure_client`/`admin_svc` to confirm graceful no-op on failure. Test `ConfigManager.save_config`/`get_config` against a fake `StorageBackend` for backup-on/off behavior.
- **Frontend:** Vitest unit tests for `SchemaForm` should cover `validate()` (required/min/type rules) and `getData()` (default backfilling) against representative schema fragments (object, array, `patternProperties`), plus `_updateValue()` path parsing edge cases (`arr[0].name`, `deeply.nested.obj`).
- **Integration:** exercise a full round trip per config domain — `GET schema` → render → edit → `validate()` → `POST content` → `GET` again to confirm persisted shape — since there is no server-side schema check to catch a client/schema mismatch before it reaches storage.
