# Backend Data Architecture

This document describes the layered data architecture from the REST API endpoints
down to the internal domain representation.  It covers each layer's purpose, the
data shapes passed across layer boundaries, and the concrete classes involved.

---

## Layer map

```
┌──────────────────────────────────────────────────────────────────────────┐
│  HTTP Client (Browser / Frontend JS)                                     │
│  Sends / receives JSON over REST                                         │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │  HTTP  JSON
┌────────────────────────────▼─────────────────────────────────────────────┐
│  REST API layer   planner_lib/projects/api.py                            │
│  FastAPI router — session auth, query-param parsing, credential          │
│  construction.  Returns List[DomainTask] (auto-serialised to JSON).      │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │  List[DomainTask] / WriteResult
┌────────────────────────────▼─────────────────────────────────────────────┐
│  Repository layer                                                        │
│   TaskRepository     planner_lib/repository/task_repository.py           │
│   HistoryRepository  planner_lib/repository/history_repository.py        │
│                                                                          │
│  Owns project-map iteration and credential resolution.                   │
│  Post-fills task['project'] after each backend fetch.                    │
│  Composes with BackendPort — does NOT know which backend is active and   │
│  contains no Azure-specific logic.                                       │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │  BackendPort methods
                             │  (fetch_tasks / write_task / fetch_history …)
┌────────────────────────────▼─────────────────────────────────────────────┐
│  CachingBackend (optional)   planner_lib/backend/caching.py              │
│  Transparent TTL wrapper around whichever backend is selected.           │
│  Two-tier: hot memory + persistent disk.  Stores enriched DomainTask     │
│  lists so cache hits need no adapter work.  Automatically caches every   │
│  BackendPort read method via a generic __getattribute__ interceptor;     │
│  adding new read methods to BackendPort requires no changes here.        │
│  Activated by feature_flag enable_cache.                                 │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │  BackendPort methods (on cache miss, or
                             │  directly when CachingBackend is not active)
         ┌───────────────────┴─────────────────────────┐
         │                                             │
         │  ADO-family backends                        │  Native-domain backends
         │  Return raw ADO dicts internally;           │  Return DomainTask directly —
         │  use AzureAdapter to translate to           │  no adapter step needed.
         │  DomainTask before returning.               │  File / store already stores
         │                                             │  domain format.
         │                                             │
┌────────▼──────────────────────────────┐   ┌─────────▼─────────────────────┐
│  AzureDevOpsBackend                   │   │  StaticBackend                │
│  planner_lib/backend/azure.py         │   │  planner_lib/backend/static.py│
│  Live ADO.  Single-pass fetch.        │   │  Read-only YAML / JSON file.  │
│                                       │   │  Loads pre-built DomainTask   │
│  MockFixtureBackend                   │   │  dicts and serves them as-is. │
│  MockGeneratorBackend                 │   │                               │
│  planner_lib/backend/mock.py          │   │  (future standalone backends  │
│  Replay fixtures or generate          │   │   follow the same pattern)    │
│  synthetic data.  Same raw ADO        │   └───────────────────────────────┘
│  dict shape as the live client.       │
│                                       │
│   ┌───────────────────────────────┐   │
│   │  AzureAdapter  (internal)     │   │
│   │  planner_lib/backend/adapter  │   │
│   │  to_domain()                  │   │
│   │  raw ADO dict → DomainTask    │   │
│   └───────────────┬───────────────┘   │
│                   │                   │
│   ┌───────────────▼───────────────┐   │
│   │  AzureNativeClient            │   │
│   │  AzureMockClient              │   │
│   │  MockGenerator                │   │
│   │  planner_lib/azure/           │   │
│   │  SDK wrappers — return raw    │   │
│   │  planner-normalised ADO dicts │   │
│   └───────────────┬───────────────┘   │
└───────────────────┼───────────────────┘
                    │  HTTPS / fixture files
          ┌─────────▼──────────────────┐
          │  Azure DevOps (external)   │
          │  dev.azure.com             │
          │  — or —                    │
          │  Local ADO fixture files   │
          └────────────────────────────┘
```

---

## Backend selection (BackendRegistry)

`planner_lib/backend/registry.py` selects **one** inner backend at startup from
`feature_flags` in `server_config.yml`.  Priority order (first flag set wins):

| Priority | Class | feature_flag | Adapter needed |
|----------|-------|-------------|----------------|
| 1 | `StaticBackend` | `use_static_backend` | No — file already in DomainTask format |
| 2 | `MockGeneratorBackend` | `use_azure_mock_generator` | Yes — generates raw ADO-shaped dicts |
| 3 | `MockFixtureBackend` | `use_azure_mock` | Yes — replays raw ADO-shaped fixture dicts |
| 4 (default) | `AzureDevOpsBackend` | *(none required)* | Yes — returns raw ADO API dicts |

`CachingBackend` is then optionally layered **in front of** the selected inner
backend when `enable_cache: true`.  It is not itself selectable — it always
wraps whatever the registry chose.

DI wiring lives in `planner_lib/main.py` `_build_services()`, using the
`ServiceContainer` registry (`planner_lib/services/container.py`).

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
  "relations":     List[{        # ADO relation objects
                     "type": str,
                     "id":   str,
                     "url":  str
                   }]
  "description":   str | None    # HTML body of the work item
  "assignee":      str | None    # display name
  "tags":          str | None    # semicolon-separated tag string
  "areaPath":      str | None    # e.g. "MyProject\\Team\\SubArea"
  "url":           str | None    # ADO web link
}
```

### 2. DomainTask (canonical internal representation)

`planner_lib/domain/tasks.py` — a `TypedDict` that is the single format used
by all layers above `AzureAdapter`.  Field names match what the frontend
JavaScript `State` service expects, so no further transformation is needed
before serialisation to JSON.

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
  "_inferred_start": bool          # set when start came from iteration dates
  "_inferred_end":   bool          # set when end came from iteration dates
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

Returned by `TaskRepository.write()` and `BackendPort.write_task()`.

```
WriteResult = TypedDict {
  "ok":      bool
  "updated": int
  "errors":  List[str]
}
```

### 4. DomainHistoryEntry / DomainTaskHistory

`planner_lib/domain/history.py` — used by `HistoryRepository` and the
`/history` endpoint.

```
DomainHistoryEntry = TypedDict {
  "field":      str           # "start" | "end" | "iteration"
  "value":      str | None    # new value at this revision
  "changed_at": str           # ISO 8601 timestamp
  "changed_by": str           # user display name or email
  "pair_id":    int           # (NotRequired) groups paired start/end changes
}

DomainTaskHistory = TypedDict {
  "task_id":  int
  "title":    str
  "plan_id":  str
  "history":  List[DomainHistoryEntry]
}
```

### 5. BackendCredential

`planner_lib/backend/port.py` — credential passed on live ADO calls.

```
BackendCredential = TypedDict {
  "token":   str    # PAT or other auth token; never logged
  "user_id": str    # session / user identifier (audit only)
}
```

---

## BackendPort interface

All concrete backends implement this `@runtime_checkable` Protocol
(`planner_lib/backend/port.py`):

```python
class BackendPort(Protocol):

    def fetch_tasks(
        self,
        area_path: str,
        task_types: Optional[List[str]] = None,
        include_states: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainTask]: ...

    def write_task(
        self,
        task_id: int,
        updates: Dict[str, Any],
        credential: BackendCredential,
    ) -> WriteResult: ...

    def fetch_history(
        self,
        work_item_id: int,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainHistoryEntry]: ...

    def fetch_teams(
        self, project: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]: ...

    def fetch_plans(
        self, project: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]: ...

    def fetch_markers(
        self, area_path: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]: ...

    def fetch_iterations(
        self, project: str,
        root_paths: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]: ...

    def invalidate_cache(self) -> Dict[str, Any]: ...
```

**Credential rules:**

- `fetch_*` methods: `credential` is *optional* — a `CachingBackend` can serve
  a cache hit without one.  When the cache is cold and no credential is
  present, the inner backend raises `PermissionError`.
- `write_task`: credential is *always required*.

---

## AzureAdapter translation (ADO-family backends only)

`planner_lib/backend/adapter.py` — used internally by `AzureDevOpsBackend`,
`MockFixtureBackend`, and `MockGeneratorBackend`.  `StaticBackend` does not
use it.

The adapter is invoked **inside the backend**, not at the repository layer.
`project_slug` is derived from the `area_path` (first path segment, slugified)
and `server_config` is read from storage — neither is passed through the
`BackendPort` interface.

```
  Raw ADO dict                         DomainTask
  ─────────────                        ──────────
  id              (int)    → str  →    id
  title                    →           title
  type            (raw)    → canonical casing → type
  state                    →           state
  ─ (derived from area_path) ─  project_slug →  project  ← overwritten by
                                                           TaskRepository with
                                                           the project map pid
  startDate       →  (or inferred from iteration) →  start
  finishDate      →  (or inferred from iteration) →  end
  iterationPath            →           iterationPath
  parentId                 →           parentId
  relations                →           relations (DomainRelation list)
  description     → capacity_service.parse() →   capacity (DomainCapacity list)
  description              →           description
  assignee                 →           assignee
  tags                     →           tags
  areaPath                 →           areaPath
  url                      →           url
```

Date inference: when `startDate` or `finishDate` is absent on the raw item,
`AzureAdapter` looks up the `iterationPath` in the `iteration_map` (pre-fetched
by `AzureDevOpsBackend._build_iteration_map()`) and copies the sprint's
`startDate` / `finishDate`.  The `_inferred_start` / `_inferred_end` flags are
set on the `DomainTask` so the frontend can signal inferred dates differently.

---

## CachingBackend tiering

```
Any fetch_*(…) call
       │
       ▼
  CachingBackend.__getattribute__ intercepts any BackendPort read method
  not explicitly overridden on the class.  Key built from:
    SHA-256(method_name + non-credential args)[:20]  →  stable, collision-free
       │
       ▼
  Hot memory cache  (MemoryCacheManager, in-process)
  namespace: backend_domain
       │ miss
       ▼
  Disk cache  (CacheManager / diskcache, persistent)
  namespace: backend_domain
       │ miss
       ▼
  inner.<method>(…)  ← credential forwarded here on miss
       │
       └─ write to disk cache → write to memory cache → return
```

Cache stores **DomainTask** lists and other domain objects (already enriched),
not raw ADO dicts.
TTL default: 30 minutes (`CACHE_TTL` in `planner_lib/azure/caching.py`).

`write_task` always bypasses the cache, then invalidates **all** entries in
both tiers (area path for a task is not known from its ID alone).  A targeted
per-area invalidation can be added later if `area_path` is included in the
write payload.

Adding a new read method to `BackendPort` is cached automatically — no changes
to `CachingBackend` are required.

---

## Iterations path construction

Iteration node paths are an ADO-project-level concept
(`"<Project>\\Iteration\\<sub-path>"`).  `iterations.yml` stores only the
sub-path (e.g. `"eSW\\Platform"`).  Path construction is the responsibility
of the backend, not the repository:

- `TaskRepository.list_iterations()` reads `raw_roots` from `iterations.yml`
  and passes them as-is to `backend.fetch_iterations(project, root_paths=raw_roots)`.
- `AzureDevOpsBackend.fetch_iterations()` prepends `"<project>\\Iteration\\"` to
  each root before calling the ADO SDK.
- Mock and static backends do the same if applicable.

This keeps the repository free of ADO-specific path knowledge.

---

## Static data file format (StaticBackend)

For offline / demo deployments (`use_static_backend: true`), the data file is
a YAML or JSON mapping of `area_path → List[DomainTask]`:

```yaml
"MyOrg\\TeamA":
  - id: "42"
    title: "Implement feature X"
    type: Feature
    state: Active
    project: project-team-a
    start: "2026-05-01"
    end: "2026-06-30"
    capacity: []
    relations: []

# Optional top-level keys
_teams:    []        # list of {id, name, …}
_plans:    []        # list of {id, name, teams, …}
_markers:  []        # list of marker dicts
_iterations: {}      # iteration_path → {startDate, finishDate, name}
```

`StaticBackend` serves the `DomainTask` dicts **as-is** — no adapter step.

---

## Key files reference

| File | Purpose |
|------|---------|
| `planner_lib/domain/tasks.py` | `DomainTask`, `WriteResult`, `DomainRelation`, `DomainCapacity` TypedDicts |
| `planner_lib/domain/history.py` | `DomainHistoryEntry`, `DomainTaskHistory` TypedDicts |
| `planner_lib/backend/port.py` | `BackendPort` Protocol, `BackendCredential`, `CredentialProvider` |
| `planner_lib/backend/adapter.py` | `AzureAdapter` — raw ADO ↔ DomainTask translation |
| `planner_lib/backend/azure.py` | `AzureDevOpsBackend` — live ADO implementation |
| `planner_lib/backend/caching.py` | `CachingBackend` — two-tier TTL wrapper |
| `planner_lib/backend/static.py` | `StaticBackend` — read-only file backend |
| `planner_lib/backend/mock.py` | `MockFixtureBackend`, `MockGeneratorBackend` |
| `planner_lib/backend/registry.py` | Backend selection by feature_flags priority |
| `planner_lib/repository/task_repository.py` | `TaskRepository` — project-map iteration, completed-task split |
| `planner_lib/repository/history_repository.py` | `HistoryRepository` — per-task revision history |
| `planner_lib/projects/api.py` | FastAPI router — REST endpoints |
| `planner_lib/services/container.py` | `ServiceContainer` DI, `ServiceKeys` constants |
| `planner_lib/main.py` | `_build_services()` — wires all services together |
