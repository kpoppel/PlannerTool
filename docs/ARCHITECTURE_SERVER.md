**PlannerTool Server Architecture**

Purpose: a concise overview of the backend server architecture and module responsibilities for developers. This document describes high-level layered structure, module organization, and key patterns. It avoids line-level detail in favor of responsibilities and design principles.

**System Overview**

- **Tech stack:** Python 3.x, FastAPI for REST API, async/await for request handling, pluggable storage backends (file-based YAML/Pickle, in-memory mock), threading for session management, Azure DevOps SDK integration for work-item data.
- **Design principles:** layered separation of concerns (API routes, services, storage); pluggable storage and Azure client implementations; dependency injection container for service composition; stateless service design; feature flags for gradual feature rollout.
- **Runtime:** Uvicorn ASGI server exposing HTTP endpoints at `/api/*`. Serves static SPA from `www/` at root and `/static/`.

**Layered Architecture**

1. **API Routes (routers in `projects/api.py`, `scenarios/api.py`, etc.):** FastAPI router definitions that handle HTTP requests. Responsibilities: parse request parameters, extract session/user context, delegate to services, format responses. All routes require session authentication (enforced by `@require_session` decorator). Routes do not contain business logic — they resolve services from the container and call them. Error handling converts exceptions to appropriate HTTP status codes.

2. **Middleware (`middleware/`):** Cross-cutting concerns applied to all requests. Includes:
   - `SessionMiddleware`: extracts session ID from cookies, validates session, attaches user context to request.
   - `BrotliCompression`: optional compression middleware for response payloads (enabled via feature flag).
   - Error handlers for 401 (access denied) and 404 (not found) responses.

3. **Services (`services/`, `projects/`, `scenarios/`, `cost/`, `accounts/`, `admin/`):** Encapsulate domain logic, state management, and orchestration. Services own their concerns:
   - **State & Config Services** (`State.js`, `ConfigService`): manage baseline data (projects, teams) and application configuration.
   - **Project/Team/Capacity Services** (`ProjectService`, `TeamService`, `CapacityService`): domain-specific operations for project and team data.
   - **Task Service** (`TaskService`): integrates with Azure DevOps SDK to fetch work items, markers, dependencies. Orchestrates across ProjectService, TeamService, CapacityService, and AzureService.
   - **Scenario Service** (`ScenarioManager`, `ScenarioStore`): manages user-created scenarios (variations of the baseline) and stores them in persistence.
   - **Cost Service** (`CostService`): computes cost metrics based on features and projects.
   - **Account/Session Services** (`AccountManager`, `SessionManager`): user authentication, email validation, session lifecycle.
   - **Admin Service** (`AdminService`): admin-only operations (user management, migrations, configuration updates).

4. **Azure Integration (`azure/`):** Abstracts Azure DevOps SDK interaction. Responsibilities:
   - `AzureService` (stateless): factory for per-request concrete clients bound to a Personal Access Token (PAT).
   - Concrete clients (`AzureNativeClient`, `AzureCachingClient`): manage SDK lifecycle, implement caching strategies. Clients are context-managers; callers use `with service.connect(pat) as client:` to obtain short-lived instances.
   - Specialized modules (`work_items.py`, `teams_plans.py`, `markers.py`, `caching.py`): logic for fetching work items, team plans, delivery markers, and optional in-memory caching.

5. **Storage (`storage/`):** Pluggable persistence layer. Responsibilities:
   - `StorageBackend` (protocol): abstract interface with methods `save`, `load`, `delete`, `list_keys`, `exists`, `configure`.
   - Implementations: `FileBackend` (file-based YAML/Pickle), `MemoryBackend` (in-memory for tests), `Accessor` (thin wrapper).
   - Serializers: `YamlSerializer`, `PickleSerializer` — pluggable format handlers.
   - Namespacing: storage is organized by namespace (e.g., "config", "scenarios", "accounts") so multiple backends can coexist (one for YAML config, one for Pickle state).

6. **Dependency Injection & Wiring (`services/container.py`, `planner_lib/main.py`):** Centralizes service composition and dependency graph. Responsibilities:
   - `ServiceContainer`: simple registry with singleton and factory support.
   - `main.py::create_app()`: factory function that instantiates all services, registers them, builds FastAPI app, attaches routers. Avoids import-time side-effects so tests can construct isolated apps with custom configurations.
   - `resolver.py`: request-scoped service resolution via `resolve_service(request, 'service_name')`.

7. **Configuration & Initialization (`logging_config.py`, `setup.py`, `planner_lib/__init__.py`):** Application setup and feature flags.
   - Logging: structured logging with configurable levels.
   - Feature flags: stored in server configuration; used to gate capabilities (e.g., Brotli compression, Azure caching).

**Entry Points**

- **`planner.py`** (root): simple factory entry point. Provides `make_app()` for server runners and `if __name__ == "__main__"` for local testing.
- **`planner_lib/main.py`** (core): `create_app(config: Config) -> FastAPI` performs all composition. All business logic is driven from here.

**Key Design Patterns**

**Service Composition via Factory Pattern**
- `create_app(Config)` instantiates all services and registers them in the ServiceContainer.
- Each service receives its dependencies (storage, other services) via constructor injection.
- Services are registered as singletons; they are created once at app startup and reused across requests.

**Pluggable Backends**
- Storage: file-based, memory-based, or custom implementations all conform to `StorageProtocol`.
- Azure clients: `AzureNativeClient` vs `AzureCachingClient` selected via feature flags; both implement the same context-manager interface.
- Serializers: YAML vs Pickle selected per backend; implementations are swappable.

**Per-Request Service Resolution**
- Routes receive the `Request` object and call `resolve_service(request, 'service_key')` to retrieve services from the container.
- This decouples routes from the global app state and allows tests to inject custom services.
- SessionMiddleware attaches the container and session info to `request.state` for access by resolvers.

**Stateless Service Design**
- Services do not hold mutable state across requests. State is stored in persistence (storage backends).
- Example: `AzureService` holds organization URL and storage but not a PAT or active connection; callers must provide a PAT to obtain a concrete client via `connect(pat)`.
- Session state is managed by `SessionManager` in-memory storage (thread-safe dict) for the duration of the app; user scenarios and accounts are persisted to storage backends.

**Context-Manager Pattern for Resource Management**
- Azure clients and storage backends use context-managers to ensure resource cleanup (e.g., closing SDK connections).
- Example: `with azure_service.connect(pat) as client: client.get_work_items(...)`.

**Feature Flags for Gradual Migration**
- Configuration includes feature flags (e.g., `enable_azure_cache`, `cache_azure_plans`) that gate optional capabilities.
- Services check flags at runtime (not import time) so deployments can test new features gradually.
- Goal: remove flags progressively as features stabilize.

**Error Handling & Validation**
- Services raise domain-specific exceptions (e.g., `KeyError` for missing data, `ValueError` for invalid input).
- Routes catch exceptions and convert them to appropriate HTTP responses (4xx for client errors, 5xx for server errors).
- ValidationErrors from Pydantic models are auto-converted by FastAPI.

**Authentication & Authorization**
- `SessionMiddleware` validates session cookies and creates sessions on-demand for new users.
- All routes except `/config` and `/account` (setup) require valid sessions.
- Admin routes check user role (stored in session) to restrict access.

**Data Namespacing & Isolation**
- Storage is organized by namespace (e.g., "config", "scenarios", "accounts") so multiple backends can coexist without collision.
- User scenarios are stored under a user-id key to ensure isolation.
- Configuration is shared (all users access the same projects/teams) while user data (scenarios, session state) is isolated.

**Module Responsibilities Summary**

| Module | Responsibility |
|--------|-----------------|
| `projects/` | List teams, projects; manage team load calculations via CapacityService |
| `projects/project_service.py` | Load project configuration; expose project list |
| `projects/team_service.py` | Load team configuration; expose team list |
| `projects/capacity_service.py` | Calculate per-team capacity based on work items |
| `projects/task_service.py` | Integrate with Azure to fetch work items, markers, dependencies; orchestrate across other services |
| `scenarios/` | Save/load/list user scenarios (baseline variations) |
| `scenarios/scenario_store.py` | Persistence operations for scenarios (save, load, delete) |
| `accounts/` | User email validation, account creation, session management |
| `accounts/config.py` | Email validation logic, account storage abstraction |
| `accounts/api.py` | HTTP endpoints for account setup |
| `azure/` | Abstract Azure DevOps SDK access; factory for concrete clients |
| `azure/__init__.py` | AzureService (stateless service); client selection via feature flags |
| `azure/AzureNativeClient.py` | Native Azure SDK client; works with PAT directly |
| `azure/AzureCachingClient.py` | Caching wrapper around AzureNativeClient; optional in-memory cache |
| `azure/work_items.py` | Fetch work items from Azure; parse properties |
| `azure/teams_plans.py` | Fetch team plans; parse iterations and sprints |
| `azure/markers.py` | Parse delivery plan markers from Azure |
| `cost/` | Compute cost metrics |
| `cost/engine.py` | Cost calculation algorithm |
| `cost/service.py` | Cost service orchestration; expose cost API |
| `admin/` | Admin-only operations |
| `admin/service.py` | Admin logic (user management, config updates) |
| `admin/api.py` | HTTP endpoints for admin actions |
| `storage/` | Pluggable persistence |
| `storage/base.py` | Abstract StorageBackend base class |
| `storage/file_backend.py` | File-based backend using OS filesystem |
| `storage/memory_backend.py` | In-memory backend for tests |
| `storage/serializer.py` | YAML and Pickle serializers |
| `middleware/` | Cross-cutting concerns |
| `middleware/session.py` | SessionManager, SessionMiddleware; session lifecycle |
| `middleware/admin.py` | Admin route protection |
| `middleware/brotli.py` | Optional Brotli compression |
| `services/` | DI infrastructure |
| `services/container.py` | ServiceContainer (registry, singletons, factories) |
| `services/resolver.py` | Request-scoped service resolution |
| `services/interfaces.py` | Storage protocol definition |
| `server/` | Health checks and server info |
| `server/api.py` | HTTP endpoints for server status |
| `session/` | Session API endpoints |
| `session/api.py` | Session creation, validation endpoints |
| `main.py` | Application factory; composes all services and registers routers |
| `logging_config.py` | Logging setup and configuration |
| `setup.py` | Feature flag access; initialization helpers |
| `util.py` | General-purpose utilities (e.g., slugify) |

**Request Flow Example**

Here's a typical request flow for fetching tasks:

1. Client sends GET `/api/tasks?project=project-id` with sessionId cookie.
2. SessionMiddleware validates cookie, extracts session ID, loads session data (user email, PAT) into `request.state`.
3. Route handler `api_tasks()` calls `resolve_service(request, 'task_service')` to get TaskService instance.
4. TaskService calls ProjectService to validate project, TeamService to list teams, CapacityService to compute capacity.
5. TaskService calls `azure_service.connect(pat)` to obtain a per-request concrete client.
6. Concrete client (AzureNativeClient or AzureCachingClient) connects to Azure, fetches work items, parses them.
7. TaskService filters and transforms work items into frontend-ready format.
8. Route returns JSON response to client.

**Data Flow: Baseline → Scenario**

1. Server configuration (projects, teams) is stored in YAML and loaded at startup via ProjectService and TeamService.
2. Azure DevOps provides live work-item data (linked work items, effort, team assignments).
3. TaskService merges configuration with Azure data.
4. Client-side state (www/js) computes derived data (effective features, capacity).
5. User creates a scenario (variation of baseline) and sends it to `/api/scenario` POST.
6. Route handler saves scenario to storage under user ID using ScenarioStore.
7. Client can later load scenario via GET `/api/scenario?id=scenario-id`.

**Testing Strategy**

- **Unit tests:** Test services in isolation using mock storage (MemoryBackend), mock Azure clients, and fixture data.
- **Integration tests:** Wire services together with real storage backends and verify end-to-end flows.
- **Route tests:** Mock services, call route handlers directly or via test client, verify response format and status codes.
- **Storage tests:** Test storage implementations with various formats (YAML, Pickle) and ensure data round-trips correctly.
- **Dependency injection tests:** Verify ServiceContainer registration and resolution, test app factory with custom Config.

**Development Guidelines**

**Adding a New Endpoint**
1. Create or extend an API router in `module/api.py`.
2. Decorate with `@router.get/post/put/delete(...)` and `@require_session` if authentication is needed.
3. Extract service from container via `resolve_service(request, 'service_key')`.
4. Call service method; handle exceptions and return appropriate HTTP status code.

**Adding a New Service**
1. Create `module/service.py` and implement the domain logic.
2. Declare a protocol in `module/interfaces.py` for testability (dependency inversion).
3. Instantiate and register the service in `main.py::create_app()` under a unique key.
4. Inject dependencies (storage, other services) via constructor.

**Adding a New Storage Backend**
1. Implement `StorageProtocol` (methods: `save`, `load`, `delete`, `list_keys`, `exists`, `configure`).
2. Ensure thread-safety if necessary (e.g., FileBackend uses filesystem locks).
3. Create a factory or wiring logic in `storage/__init__.py`.
4. Update `main.py` to allow config-time backend selection.

**Adding a New Serializer**
1. Implement the serializer protocol in `storage/serializer.py`.
2. Register with the backend's serializer registry.
3. Test round-tripping (serialize → deserialize → equality).

**Configuration & Feature Flags**
- Configuration is stored in `data/config/server_config.yml` and loaded by ProjectService, TeamService, and other services.
- Feature flags are keys in the server config under `feature_flags` section.
- At runtime, services check flags via config lookups or via the `setup.py::has_feature_flag()` helper.
- To add a flag: update server config, check flag in service code, gate the behavior.

**Known Limitations & Future Improvements**

- **Session persistence:** SessionManager stores sessions in-memory; server restart loses all sessions. Consider persistent session store (e.g., Redis).
- **Admin service complexity:** AdminService handles multiple concerns (user management, config updates); could be split into smaller services.
- **Error codes:** Error responses could use standardized error codes and schemas for better client handling.
- **Caching strategy:** Azure caching is per-client instance; could be improved with request-scoped or app-scoped caches.
- **TypeScript/Strong typing:** Python types are good but could be stricter. Consider gradual migration to TypeScript or stricter Python type checking.
- **Async services:** Some services are sync; consider async/await for I/O-bound operations (storage, Azure SDK).
- **Testing coverage:** Aim for >80% statement coverage on services; prioritize high branch coverage for critical paths.

**Deployment & Operations**

- **Environment variables:** Configuration via `Config` dataclass (e.g., `data_dir`, `storage_backend`).
- **Logging:** Structured logging with configurable levels. Output to console or file via `logging_config.py`.
- **Health checks:** `/api/server/health` endpoint for monitoring.
- **Performance:** Feature flags control expensive operations (e.g., Azure caching); use flags to tune performance for large workloads.
- **Scaling:** Stateless service design allows horizontal scaling. Session state and user data must be persisted to a shared backend (not in-memory) for multi-instance deployments.

**Directory Structure Quick Reference**

```
planner_lib/
  __init__.py
  main.py                    # App factory: create_app(Config)
  logging_config.py          # Logging setup
  setup.py                   # Feature flags, initialization
  util.py                    # Utilities (e.g., slugify)
  
  accounts/                  # User authentication & accounts
    config.py                # Email validation, account storage
    api.py                   # HTTP endpoints
    interfaces.py            # Protocols
    
  admin/                     # Admin operations
    service.py               # Admin logic
    api.py                   # HTTP endpoints
    
  azure/                     # Azure DevOps integration
    __init__.py              # AzureService (stateless)
    AzureNativeClient.py     # Native SDK client
    AzureCachingClient.py    # Caching wrapper
    work_items.py            # Work-item parsing
    teams_plans.py           # Team plan fetching
    markers.py               # Delivery marker parsing
    caching.py               # Cache implementation
    interfaces.py            # Protocols
    
  cost/                      # Cost calculations
    engine.py                # Algorithm
    service.py               # Cost service
    api.py                   # HTTP endpoints
    
  middleware/                # Cross-cutting concerns
    session.py               # SessionManager, SessionMiddleware
    admin.py                 # Admin protection
    brotli.py                # Compression
    interfaces.py            # Protocols
    
  projects/                  # Projects & teams
    project_service.py       # Project listing
    team_service.py          # Team listing
    capacity_service.py      # Capacity calculation
    task_service.py          # Task/work-item fetching
    api.py                   # HTTP endpoints
    interfaces.py            # Protocols
    
  scenarios/                 # User scenarios
    scenario_store.py        # Scenario persistence
    api.py                   # HTTP endpoints
    
  server/                    # Server info & health
    api.py                   # HTTP endpoints (health check)
    health.py                # Health check logic
    
  services/                  # DI infrastructure
    container.py             # ServiceContainer
    resolver.py              # Service resolution
    interfaces.py            # Storage protocol
    
  session/                   # Session endpoints
    api.py                   # HTTP endpoints
    
  storage/                   # Persistence layer
    base.py                  # StorageBackend base class
    file_backend.py          # File-based backend
    memory_backend.py        # In-memory backend
    serializer.py            # YAML & Pickle serializers
    accessor.py              # Storage wrapper
    interfaces.py            # Protocols
```

End of architecture document.
