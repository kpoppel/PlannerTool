# Backend Data Architecture

This document describes the layered data architecture from the REST API endpoints
and application services down to the data backends.  It covers each layer's
purpose, the data shapes passed across boundaries, and the concrete classes
involved.

---

## Design principles

The architecture follows Interface Segregation and Open/Closed principles
throughout.

**Focused protocols** — each data domain is defined by its own
`@runtime_checkable` Protocol in `planner_lib/backend/port.py`.  Backends only
implement the protocols for the domains they own — no empty stubs required.

**Repository per domain** — each repository depends on exactly the focused
protocol(s) it needs.  No repository holds a reference to a concrete backend
class.

**CachingBackend is a transparent TTL proxy** — it wraps any backend, intercepts
every `fetch_*` method via `__getattribute__`, and routes reads through
`diskcache` with a per-method TTL.  The same protocol appears on both sides of
the proxy; callers never need to know whether a cache is present.

**ConfigBackend is diskcache-backed** — after migrations 0021 and 0022, `ConfigBackend`
reads and writes all config keys (projects, teams, people, cost_config, iterations,
area_plan_map, global_settings, ado_config) directly to diskcache.  It is a
peer of `UserDataBackend` — not wrapped in `CachingBackend`.  `server_config.yml`
(generic server settings) remains human-editable YAML.

**UserDataBackend is never cached** — user mutations (scenarios, views) are
written directly to `diskcache`.  Wrapping in `CachingBackend` would cause reads
to serve stale data after a write.

| Protocol | Owner | Methods |
|----------|-------|---------|
| `TaskBackend` | ADO-family, `StaticBackend` | `fetch_tasks`, `write_task`, `invalidate_cache` |
| `HistoryBackend` | ADO-family, `StaticBackend` | `fetch_history` |
| `TeamsBackend` | ADO-family, `StaticBackend` | `fetch_teams` |
| `PlansBackend` | ADO-family, `StaticBackend` | `fetch_plans`, `fetch_markers` |
| `IterationsBackend` | ADO-family, `StaticBackend` | `fetch_iterations` |
| `BackendPort` | ADO-family, `StaticBackend` | Composite of the five remote-data protocols |
| `PeopleBackend` | `ConfigBackend` | `fetch_people` |
| `ProjectConfigBackend` | `ConfigBackend` | `fetch_projects`, `fetch_project_map` |
| `TeamConfigBackend` | `ConfigBackend` | `fetch_config_teams` |
| `IterationConfigBackend` | `ConfigBackend` | `fetch_iterations_config` |
| `PlanConfigBackend` | `ConfigBackend` | `fetch_area_plan_map` |
| `AdoConfigBackend` | `ConfigBackend` | `fetch_ado_config`, `save_ado_config` |
| `ScenarioBackend` | `UserDataBackend` | `fetch_scenarios`, `fetch_scenario`, `save_scenario`, `delete_scenario` |
| `ViewBackend` | `UserDataBackend` | `fetch_views`, `fetch_view`, `save_view`, `delete_view` |

To add a new data domain:
1. Define a new focused Protocol in `port.py` (e.g. `BudgetBackend`).
2. Implement it in the backend(s) that own that data.
3. Create a repository that depends only on the new protocol.
4. Register a new DI key and wire the repository in `main.py`.
5. No changes needed to any other backend or repository.

---

## Layer map

```
┌──────────────────────────────────────────────────────────────────────────┐
│  HTTP Client (Browser / Frontend JS)                                     │
│  Sends / receives JSON over REST                                         │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │  HTTP  JSON
┌────────────────────────────▼─────────────────────────────────────────────┐
│  Consumers                                                               │
│                                                                          │
│  REST API layer  planner_lib/projects/api.py (and other api.py modules)  │
│  FastAPI router — session auth, query-param parsing, credential          │
│  construction.  Returns domain types (auto-serialised to JSON).          │
│                                                                          │
│  CostService     planner_lib/cost/service.py                             │
│  AdminService    planner_lib/admin/service.py                            │
│  … (other application services that compute over domain data)            │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │  domain types
┌────────────────────────────▼─────────────────────────────────────────────┐
│  Repository layer  planner_lib/repository/                               │
│                                                                          │
│  Each repository depends on exactly the focused protocol it needs.       │
│  No repository imports a concrete backend class.                         │
│                                                                          │
│  TaskRepository(TaskBackend)           ← DI key: "backend"               │
│  HistoryRepository(HistoryBackend)     ← DI key: "backend"               │
│  PlanRepository(PlansBackend,          ← DI keys: "backend",             │
│                 plan_config:PlanConfigBackend)          "config_backend" │
│  IterationRepository(IterationsBackend,← DI keys: "backend",             │
│                 iteration_config:IterationConfigBackend)"config_backend" │
│  PeopleRepository(PeopleBackend)       ← DI key: "config_backend"        │
│  TeamRepository(TeamConfigBackend)     ← DI key: "config_backend"        │
│  ProjectRepository(ProjectConfigBackend)← DI key: "config_backend"       │
│  ScenarioRepository(ScenarioBackend)   ← DI key: "user_data_backend"     │
│  ViewRepository(ViewBackend)           ← DI key: "user_data_backend"     │
└────────────────────────────────────────────────────────────────────────┬─┘
                                                                         │
                                                     domain types from any backend
┌────────────────────────────────────────────────────▼─────────────────────┐
│  diskcache (one shared SQLite instance)                                  │
│  planner_lib/storage/diskcache_backend.py                                │
│                                                                          │
│  All domain objects land here regardless of their origin (ADO,           │
│  YAML config, or user mutations).  Hot data is served directly from      │
│  SQLite's OS-page cache without extra in-process structures.             │
│                                                                          │
│  CachingBackend(inner, storage=diskcache) wraps any read-only source:    │
│  – On fetch_* miss: call inner, store result in diskcache, return.       │
│  – On fetch_* hit:  return from diskcache without touching inner.        │
│  – On write_task:   delegate to inner, patch task in every cached list   │
│                     (diskcache is immediately consistent, TTL unchanged).│
│  – On invalidate:   delete all keys in the namespace.                    │
└──────┬───────────────────────────────────────────────────────────┬───────┘
       │ cache miss / explicit write                               │ user data
┌──────▼───────────────────────────────────────────────────┐ ┌─────▼──────────┐
│  Backing stores (fetched on cache miss only)             │ │ UserDataBackend│
│                                                          │ │ (no cache wrap)│
│  BackendRegistry selects one remote source:              │ │                │
│    AzureDevOpsBackend — live ADO via HTTPS               │ │ Reads/writes   │
│    StaticBackend      — static YAML/JSON file            │ │ directly to    │
│    MockFixtureBackend — ADO-shaped fixture files         │ │ diskcache.     │
│    MockGeneratorBackend — in-process data generator      │ │ No separate    │
│                                                          │ │ TTL layer:     │
│  ConfigBackend — reads/writes diskcache directly         │ │ diskcache IS   │
│    (people, projects, teams, cost_config, iterations,    │ │ the store.     │
│     area_plan_map, global_settings, ado_config)          │ │                │
│    people migrated to diskcache by migration 0022        │ └────────────────┘
│  server_config.yml stays YAML (human-editable)           │
└──────────────────────────────────────────────────────────┘
```

### ADO-family and StaticBackend

All ADO-family backends (`AzureDevOpsBackend`, `MockFixtureBackend`,
`MockGeneratorBackend`) return raw ADO-shaped dicts internally and use
`AzureAdapter.to_domain()` to translate to `DomainTask` before returning.
`StaticBackend` stores data already in domain format and serves it as-is —
no adapter step.

`BackendRegistry` selects the active backend at startup from `feature_flags` in
`ado_config` (diskcache key populated by migration 0021 from `server_config.yml`).
Priority order (first flag wins):

| Priority | Class | `feature_flag` | Adapter |
|----------|-------|----------------|---------|
| 1 | `StaticBackend` | `use_static_backend` | None — file already in domain format |
| 2 | `MockGeneratorBackend` | `use_azure_mock_generator` | `AzureAdapter` |
| 3 | `MockFixtureBackend` | `use_azure_mock` | `AzureAdapter` |
| 4 (default) | `AzureDevOpsBackend` | *(none required)* | `AzureAdapter` |

---

## CachingBackend and write semantics

`planner_lib/backend/caching.py` — transparent diskcache proxy for any backend.

The same `CachingBackend` pattern is used for both the remote data backend and
the config backend.  Both instances write into the same shared diskcache
SQLite file using `fetch_<method>__<key-hash>` composite keys.  From the
perspective of consumers (repositories, services), there is no difference between
data that originated in ADO, a YAML config file, or a static fixture — all
domain objects come back as the same Python types from the same store.

```
CachingBackend.__getattribute__(fetch_*)
       │
       ├── cache HIT  → return domain objects from diskcache
       │
       └── cache MISS → call inner.fetch_*()
                            → store result in diskcache with expire=ttl_seconds
                            → return result

CachingBackend.write_task(id, updates, credential)
       │
       ├── delegate to inner backend (persistence)
       └── patch task in every cached fetch_tasks__* list in-place
               → diskcache immediately consistent
               → remaining TTL preserved (no TTL clock reset)
```

### Write semantics

| Data type | Write path | Cache effect |
|-----------|-----------|-------------|
| ADO work items | `write_task(id, updates, cred)` → delegates to inner backend → patches the task in every cached `fetch_tasks__*` list in-place, preserving the existing TTL | diskcache is immediately consistent; no re-fetch from ADO. TTL-driven expiry and explicit `/cache/refresh` are the only paths that re-fetch from ADO. |
| Config (projects, teams, cost_config, …) | Admin API writes directly to diskcache via `ConfigBackend.save_config()` | Immediately consistent — diskcache IS the authoritative store. `ReloadOrchestrator.reload()` rebuilds the AzureService client from the updated `ado_config`. |
| ADO config (org URL, backend flags) | Admin `POST /admin/v1/ado` → writes `ado_config` to diskcache → `ReloadOrchestrator` reads it back and rebuilds `AzureService` | Immediately consistent. Next request uses the updated org URL and flags. |
| Server config | Admin `POST /admin/v1/system` → writes `server_config.yml` (YAML) → `ReloadOrchestrator.reload()` | YAML is the authoritative store for generic server settings. |
| User data (scenarios, views) | `save_scenario` / `save_view` → writes directly to diskcache | No separate cache layer: diskcache IS the authoritative store — reads are always consistent |

### TTLs

TTLs control how long a diskcache entry lives before the next read automatically
triggers a re-fetch.  Config data uses **no time-based TTL** (`None`) because it
only changes when an admin explicitly writes it — time-based expiry would either
serve stale data or waste cache misses unnecessarily.

| Method | Default TTL | Rationale |
|--------|-------------|-----------|
| `fetch_tasks` | 30 min | ADO state changes frequently |
| `fetch_history` | 24 h | History is append-only; rarely stale |
| `fetch_teams` | 4 h | ADO team membership |
| `fetch_plans` | 4 h | Plan markers |
| `fetch_markers` | 2 h | Sprint markers |
| `fetch_iterations` | 8 h | Sprint definitions |
| `fetch_people` | None | Config data — explicit invalidation only |
| `fetch_projects` | None | Config data — explicit invalidation only |
| `fetch_config_teams` | None | Config data — explicit invalidation only |
| `fetch_iterations_config` | None | Config data — explicit invalidation only |
| `fetch_area_plan_map` | None | Config data — explicit invalidation only |

All ADO TTLs are configurable via `cache.ttls` in `server_config.yml`
(values in minutes; `0` = no expiry).

diskcache handles the in-memory tier automatically via SQLite's memory-mapped
pages (`sqlite_mmap_size`, default 64 MB) and WAL journal mode.  No separate
in-process cache manager or warmup service is needed.

`CachingBackend` mirrors the protocol of its inner backend exactly —
`isinstance` checks work without any explicit registration:

```python
isinstance(CachingBackend(AzureDevOpsBackend(…)), BackendPort)  # True
isinstance(CachingBackend(ConfigBackend(…)), PeopleBackend)      # True
isinstance(CachingBackend(ConfigBackend(…)), BackendPort)        # False
```

---

## DI keys

| DI key | Protocol | Backend class | Notes |
|--------|----------|---------------|-------|
| `backend` | `BackendPort` | Selected by `BackendRegistry` | Wrapped in `CachingBackend` when `enable_cache: true` |
| `config_backend` | `PeopleBackend` + config protocols + `AdoConfigBackend` | `ConfigBackend` | Reads/writes diskcache directly — **not** wrapped in `CachingBackend` |
| `user_data_backend` | `ScenarioBackend` + `ViewBackend` | `UserDataBackend` | Reads/writes diskcache directly — **never** cached |

DI wiring lives in `planner_lib/main.py` `_build_services()`.

---

## Data schemas

### 1. Raw ADO dict (AzureNativeClient output)

`AzureNativeClient` normalises Azure DevOps field names to planner-friendly
keys before returning.  This is the shape consumed by `AzureAdapter.to_domain()`.

```
{
  "id":            int           # ADO work item ID
  "title":         str
  "type":          str           # e.g. "Feature", "User Story"
  "state":         str           # ADO workflow state string
  "startDate":     str | None    # ISO date "YYYY-MM-DD"
  "finishDate":    str | None    # ISO date "YYYY-MM-DD"
  "iterationPath": str | None    # e.g. "MyProject\\Iteration\\Sprint 1"
  "parentId":      str | None    # string-coerced ADO parent ID
  "relations":     List[{type, id, url}]
  "description":   str | None    # HTML body
  "assignee":      str | None    # display name
  "tags":          str | None    # semicolon-separated
  "areaPath":      str | None    # e.g. "MyProject\\Team\\SubArea"
  "url":           str | None    # ADO web link
}
```

### 2. DomainTask (canonical internal representation)

`planner_lib/domain/tasks.py` — `TypedDict` used by all layers above
`AzureAdapter`.  Field names match what the frontend JavaScript `State` service
expects.

```
DomainTask = TypedDict {
  "id":              str           # string-coerced work item ID
  "title":           str
  "type":            str           # canonical casing from task_type_hierarchy
  "state":           str
  "project":         str           # project slug e.g. "project-my-team"
  "start":           str | None    # ISO date YYYY-MM-DD  (NotRequired)
  "end":             str | None    # ISO date YYYY-MM-DD  (NotRequired)
  "iterationPath":   str | None    # (NotRequired)
  "parentId":        str | None    # (NotRequired)
  "relations":       List[DomainRelation]  # (NotRequired)
  "capacity":        List[DomainCapacity]  # (NotRequired)
  "description":     str | None    # (NotRequired)
  "assignee":        str | None    # (NotRequired)
  "tags":            str | None    # (NotRequired)
  "areaPath":        str | None    # (NotRequired)
  "url":             str | None    # (NotRequired)
  "_inferred_start": bool
  "_inferred_end":   bool
}

DomainRelation = TypedDict {
  "type":  str    # "Parent" | "Child" | "Successor" | "Predecessor" | "Related"
  "id":    str
  "url":   str    # (NotRequired)
}

DomainCapacity = TypedDict {
  "team":     str    # team slug / ID
  "capacity": float  # fractional allocation 0–1
}
```

### 3. WriteResult

```
WriteResult = TypedDict {
  "ok":      bool
  "updated": int
  "errors":  List[str]
}
```

### 4. DomainHistoryEntry / DomainTaskHistory

```
DomainHistoryEntry = TypedDict {
  "field":      str           # "start" | "end" | "iteration"
  "value":      str | None
  "changed_at": str           # ISO 8601 timestamp
  "changed_by": str
  "pair_id":    int           # (NotRequired)
}

DomainTaskHistory = TypedDict {
  "task_id":  int
  "title":    str
  "plan_id":  str
  "history":  List[DomainHistoryEntry]
}
```

### 5. BackendCredential

```
BackendCredential = TypedDict {
  "token":   str    # PAT or other auth token; never logged
  "user_id": str    # session / user identifier (audit only)
}
```

---

## Backend protocols (`planner_lib/backend/port.py`)

```python
# Remote work-item data ─────────────────────────────────────────────────

class TaskBackend(Protocol):
    def fetch_tasks(area_path, task_types, include_states, credential): ...
    def write_task(task_id, updates, credential): ...
    def invalidate_cache(): ...

class HistoryBackend(Protocol):
    def fetch_history(work_item_id, credential): ...

class TeamsBackend(Protocol):
    def fetch_teams(project, credential): ...

class PlansBackend(Protocol):
    def fetch_plans(project, credential): ...
    def fetch_markers(area_path, credential): ...

class IterationsBackend(Protocol):
    def fetch_iterations(project, root_paths, credential): ...

class BackendPort(TaskBackend, HistoryBackend, TeamsBackend,
                  PlansBackend, IterationsBackend, Protocol): ...

# Local config data (diskcache-backed) ─────────────────────────────────

class PeopleBackend(Protocol):
    def fetch_people(credential): ...

class ProjectConfigBackend(Protocol):
    def fetch_projects(credential): ...
    def fetch_project_map(credential): ...

class TeamConfigBackend(Protocol):
    def fetch_config_teams(credential): ...

class IterationConfigBackend(Protocol):
    def fetch_iterations_config(credential): ...

class PlanConfigBackend(Protocol):
    def fetch_area_plan_map(credential): ...

class AdoConfigBackend(Protocol):
    def fetch_ado_config(): ...          # organization_url + ADO feature flags
    def save_ado_config(content): ...

# Mutable user data ──────────────────────────────────────────────────────

class ScenarioBackend(Protocol):
    def fetch_scenarios(user_id): ...
    def fetch_scenario(user_id, scenario_id): ...
    def save_scenario(user_id, scenario_id, data): ...
    def delete_scenario(user_id, scenario_id): ...

class ViewBackend(Protocol):
    def fetch_views(user_id): ...
    def fetch_view(user_id, view_id): ...
    def save_view(user_id, view_id, data): ...
    def delete_view(user_id, view_id): ...
```

**Credential rules:**
- `fetch_*` on remote backends: credential is *optional* when cache is warm.
  Cold cache with no credential raises `PermissionError`.
- `write_task`: credential is *always required*.
- Config and user-data backends: credential never required.

---

## AzureAdapter translation (ADO-family backends only)

`planner_lib/backend/adapter.py` — used internally by `AzureDevOpsBackend`,
`MockFixtureBackend`, and `MockGeneratorBackend`.  `StaticBackend` and
`ConfigBackend` do not use it.

The adapter is invoked **inside the backend**, not at the repository layer.
`project_slug` is derived from the `area_path` (first path segment, slugified).

```
  Raw ADO dict                        DomainTask
  id (int)           →                id (str)
  title              →                title
  type               →                type (canonical casing)
  state              →                state
  area_path          →                project (slugified first segment)
  startDate          →                start  (or from iteration if absent → _inferred_start)
  finishDate         →                end    (or from iteration if absent → _inferred_end)
  iterationPath      →                iterationPath
  parentId           →                parentId
  relations          →                relations (List[DomainRelation])
  description        →                capacity (parsed) + description
  assignee           →                assignee
  tags               →                tags
  areaPath           →                areaPath
  url                →                url
```

---

## Static data file format (StaticBackend)

For offline / demo deployments (`use_static_backend: true`), the data file is a
YAML or JSON mapping of `area_path → List[DomainTask]`:

```yaml
"MyOrg\\TeamA":
  - id: "42"
    title: "Implement feature X"
    # … full DomainTask fields …

# Optional top-level keys
_teams:      {}   # project → list of team dicts
_plans:      {}   # project → list of plan dicts
_markers:    {}   # area_path → list of marker dicts
_iterations: {}   # project → iteration_path → {startDate, finishDate, name}
_history:    {}   # work_item_id → list of revision entries
_people:     []   # flat list of DomainPerson dicts (optional)
```

`StaticBackend` serves all domain objects **as-is** — no adapter step.

---

## Iterations path construction

`IterationRepository.list_iterations()` reads `raw_roots` from
`iterations.yml` (via `IterationConfigBackend`) and passes them to
`backend.fetch_iterations(project, root_paths=raw_roots)`.
`AzureDevOpsBackend.fetch_iterations()` prepends `"<project>\\Iteration\\"` to
each root before calling the ADO SDK — ADO path knowledge stays in the backend.

---

## Key files reference

| File | Purpose |
|------|---------|
| `planner_lib/domain/tasks.py` | `DomainTask`, `WriteResult`, `DomainRelation`, `DomainCapacity` |
| `planner_lib/domain/history.py` | `DomainHistoryEntry`, `DomainTaskHistory` |
| `planner_lib/domain/people.py` | `DomainPerson` |
| `planner_lib/domain/plans.py` | `DomainMarker` |
| `planner_lib/domain/iterations.py` | `DomainIteration` |
| `planner_lib/domain/teams.py` | `DomainTeam` |
| `planner_lib/domain/projects.py` | `DomainProject` |
| `planner_lib/backend/port.py` | All focused protocols + `BackendPort` + `BackendCredential` |
| `planner_lib/backend/adapter.py` | `AzureAdapter` — raw ADO ↔ `DomainTask` |
| `planner_lib/backend/registry.py` | `BackendRegistry` — selects active remote backend |
| `planner_lib/backend/azure.py` | `AzureDevOpsBackend` — live ADO |
| `planner_lib/backend/static.py` | `StaticBackend` — read-only file backend |
| `planner_lib/backend/mock.py` | `MockFixtureBackend`, `MockGeneratorBackend` |
| `planner_lib/backend/config.py` | `ConfigBackend` — read-only YAML config domains |
| `planner_lib/backend/user_data.py` | `UserDataBackend` — mutable user scenarios/views |
| `planner_lib/backend/caching.py` | `CachingBackend` — diskcache TTL proxy |
| `planner_lib/repository/` | One repository per domain |
| `planner_lib/main.py` | DI wiring (`_build_services`) |
| `planner_lib/storage/diskcache_backend.py` | `DiskCacheStorage` — diskcache `StorageBackend` |
