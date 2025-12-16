## Scenarios (Iteration 5)
  - Scenarios (Iteration 5): Sidebar scenarios list with a Live baseline (read-only) and non-live clones. Non-live scenarios store only date overrides. Rendering uses `state.getEffectiveFeatures()` so feature cards, timeline, and load graph reflect active scenario dates. Drag/resize writes to baseline in Live, overrides in scenarios. A menu button (⋯) provides actions: Live → Clone, Refresh from Azure DevOps (mock); Scenario → Rename, Delete, Save to Backend (mock), Save to Azure DevOps (selection modal calling mock annotate).

  - Scenario activation emits `scenario:activated`; cards and graph rerender using effective dates. Alternate month shading distinguishes scenario mode subtly.

# Project Architecture

## Overview
This project is designed to be modular, extensible, and testable, integrating a Python backend with a modern web frontend. The system enables seamless interaction between Azure DevOps data and users via a web interface, supporting both online and offline modes.

  - **Configuration:**
    - `config.yaml`: Stores credentials, organization URL, project name, and enabled area paths.
    - `work_items.json`: Is a generated file which persists work items for an offline test mode used to not over-use the API endpoint.
## Components

### 1. Python Backend
**Core Modules and Structure:**

The backend is organized for clarity, modularity, and extensibility. The main entrypoint is `planner.py`. Modules are grouped by responsibility:

```
planner.py
planner_lib/
  models/      # Data models and schemas (e.g., models/user.py, models/project.py)
  api/         # REST endpoints/controllers (e.g., api/user.py, api/project.py)
  services/    # Business logic/services (e.g., services/user_service.py)
  db/          # Database setup, migrations, session (e.g., db/connection.py)
  utils/       # Utility functions/helpers (e.g., utils/validators.py)
  config/      # Configuration (e.g., config/settings.py)
tests/
  backend/     # Backend unit/integration tests
www/           # Frontend UI files (HTML, CSS, JS)
```

- **planner.py**: Main program assembling the software and starting the web service.
- **models/**: Data models and schemas for ORM and validation.
- **api/**: REST API endpoints/controllers, organized by resource.
- **services/**: Business logic, reusable across endpoints.
- **db/**: Database connection, migrations, session management.
- **utils/**: Utility functions and helpers.
- **config/**: Configuration management.
- **tests/backend/**: Automated unit and integration tests for backend modules.
- **www/**: User interface files.

**Web Service:**
- Serves the frontend user interface (using Flask or FastAPI) for frontend communication.
- Exposes endpoints for debug/test mode: configuration, area paths, work items, and offline data.
- Exposes endpoints for the runtime user interface.

**Configuration:**
- `config.yaml`: Stores credentials, organization URL, project name, and enabled area paths.
- `work_items.json`: Generated file for offline test mode, persists work items to avoid excessive API usage.

**Testing:**
- Automated unit tests ensure correctness and maintainability.
- Tests are each in their own file.
- Testing uses the standard Python unittest framework.
- Tests are in the `tests/backend` directory.
- For Javascript tests, the Python service will serve a `test.html` page which runs unit tests on the Javascript code.

### 2. Web Frontend
- **Mockup of the UI**
  - Provider Integration (Iteration 6): All data access and mutations are routed through `dataService` which delegates to the active provider. UI modules (`state.js`, scenarios, drag updates) do not mutate global stores directly.
  - The file `mockup-image.png` shows a mockup of the user interface.
  - Description of the mockup elements:
    - Description of the UI:
        1. On the left side is a fixed width panel with a list of projects and Teams and various filters to iterated on later.  The projects and teams can be selected or deselected by using a simple checkbox. A small color icon is next to each project and team. When clicking the icon, the color can be changed.  This color is reflected in all places where the project or team is a vidual element. This panel never scrolls out of view. The width of the panel is fixed and must fit all content so line breaks are not needed.
        2. Along the top is a graph of the load on the organisation showing either the total organisational load or for individual teams. This graph is the sum of estimated load coming from the feature cards in the main part of the UI described later.  A dotted line across the graph shows 100% load.  The graph has a timeline spanning the entire width of the window. The view is a stacked step diagram of the team loads based on the selected projects and teams.The graph must align to and span the visible timeline.  Because the timeline is also used with the feature cards it is probably best to use a canvas to align the two elements.
        3. On the right side is a collapsible  panel which open when clicking a feature in the main area. It can be closed by pressing a 'X' or close button in the panel, or by clicking the card again.  This panel will contain relevant fields from a Azure Devops Task: type (Feature, Epic, ...), desciption, start and end dates and other information. It also contains a link to the task in Azure Devops.
        4. The main area consists of the aforementioned timeline with weeks, months, or years aligning with the mountain view graph described in point 2, and the feature cards. The main area is scrollable by using scrollbars horizontally and vertically.  Make three icons on the left side of the timeline to select the time resolution. The cards in the main view does not overlap and has each their own swimlane. Cards can be moved horizontally to allow simulations of the organisational load.  When a card is moved like this, it is colored orange to mark it as out of sync with the data in Azure Devops.
        5. A feature card is a card showing the feature title and estimated load on participating teams along the top of each card.  The team boxes are color coded, and the color is the same as the color a team in the left bar is configured to have. The leftmost box shows the organisational load (there is knowledge of the total number of people, teams, so these can be calculated).  The feature card itself is clearly marked with the same color as the project it was initiated for.
        The feature cards can be dragged and moved to investigate different planning scenarios.  Moving a card will update the start and end dates in the backend data structure. The cards can be moved using a date resolution of 1 day.
        6. When changing the scale of the timeline, it allows seeing cards with a hight resolution. This means cards will visually expand in width and some cards will be out of the viewport. This is just to remind that changing the timeline does not only show more or less detail on the timeline alone.
- **HTML/CSS/JavaScript:**
  - Provides a user interface for viewing and managing work items and area paths.
  - Communicates with the backend via HTTP requests (fetch/AJAX).
  - Keep the Javascript modular and extensible so that later wiring to the backend is easily done.
  - Always plan and implement unit tests of all user interface elements in a separate HTML page or pages.
  - Configuration flow (Iteration 2): A gear button in the sidebar opens a configuration view where the user enters their email and PAT. The email is stored in localStorage via `providerLocalStorage` and configuration events are emitted via `eventBus` (`config:open`, `config:updated`, `config:pat:updated`). The PAT is not stored locally; a mock submission via `dataService.setPatMock()` returns a fixed token for UI flows.
  - View Options (Iteration 2 extension): A "Condense cards" toggle reduces swimlane height and hides team load/date rows, showing only task type icon and title for higher density planning.
- **React (optional):**
  - For advanced UI, React components (e.g., Timeline, Sidebar, DetailsPanel) are used for stateful, interactive views.
- **Mockups:**
  - HTML/JS mockups for planning and prototyping UI features.

### Load Graph (Iterations 3 & 4)
- **Module:** `www/js/mainGraph.js` renders a stacked, per-day capacity graph aligned to the timeline.
- **Math:** `www/js/loadMath.js` computes raw daily team loads (Iteration 3) and normalized per-team & per-project daily loads (Iteration 4) while avoiding double counting (epic overlap exclusion when features visible).
- **Dual View (Iteration 4):** A sidebar toggle switches between Team Load mode (normalized team segments) and Project Load mode (normalized project segments aggregating selected team loads per project). Normalization divides raw percentages by the global number of teams to compute organisational capacity share.
- **Alignment:** Bars map 1 day → variable pixel width based on month length; `timeline.js` exposes months and visible range; graph renders only the visible viewport.
- **Events:** Re-renders on `feature:updated`, `projects:changed`, `teams:changed`, `filters:changed`, `timeline:months`, `view:capacityMode`, and timeline `scroll`.
- **Scaling:** Adaptive vertical scale: minimum 100%, up to ~200% with headroom; dotted 100% reference line.
- **Over-capacity:** A red 8px band below the graph marks contiguous spans where organisational load exceeds 100% (normalized total).
- **Tooltip (Iteration 4):** Delayed hover (400ms) displays date, total organizational load, and segment breakdown (team/project) with normalized percentages; segment boundaries cached per render.
- **Interaction:** Canvas now listens for `mousemove`/`mouseleave` for tooltip; retains card/timeline interaction layering.

## Data Flow
1. **Configuration Loading:**
   - Backend loads credentials and project info from `config.yaml`.
2. **Area Path Discovery:**
   - Backend queries Azure DevOps for area paths, updates `config.yaml` if new paths are found.
   - New paths are stored in the configuration file under the key `available_area_paths`.
   - The key `project_area_paths` stores a list of area paths which are interpreted as projects in the UI.
   - The key `team_area_paths` stores a list of area paths which are interpretes as teams in the UI.
   - The key `development_mode` is either `True` or `False`
3. **Work Item Retrieval:**
   - Backend fetches work items per area path under the keys `project_area_paths` and `team_area_paths`.
   - The work items are saved to `work_items.json` for offline access if the server is running in development mode and the file does not exist.
4. **API Exposure:**
   - Backend exposes endpoints for area paths, work items, and offline data.
5. **Frontend Interaction:**
   - Frontend requests data via APIs, displays area paths and work items in tables or interactive views.
6. **Development Mode:**
   - Frontend can load cached work items from backend when in this mode.
   - Javascript test endpoints are exposed as well.

## Extensibility & Modularity
- **Backend:**
  - New API endpoints and data models can be added with minimal changes.
  - OOP design allows for easy extension of DevOps integration and configuration logic.
- **Frontend:**
  - UI components are modular and reusable.
  - API interaction logic is separated from UI rendering.
- **Testing:**
  - Unit tests cover core logic and can be extended as new features are added.

## Security & Best Practices
- Credentials are stored securely in `config.yaml` (consider environment variables for production).
- API endpoints validate input and handle errors gracefully.
- Code follows separation of concerns and single responsibility principles.
- Interfaces comply to the Open/Closed principle
- The modularity is ensured using dependency inversion so new implementations can easily be swapped in. Also good for testing with mocks.
- Documentation is always kept up to date.
- Tests are always kept up to date.

## Directory Structure (Simplified)
```
project-root/
├── config.yaml
├── planner.py
├── modules/
│   ├── client.py
│   ├── sso.py
│   ├── server.py
│   ├── ...
├── tests/
│   ├── ...
└── PROJECT_CONTEXT.md
└── ARCHITECTURE.md
└── PRODUCT.md
└── CONTRIBUTING.md
└── mockup-image.png
```

Ignore files in the directories `archived` and `devops_server`.

Note: Legacy hyphenated directory naming (`planner-lib`) has been standardized to underscore form (`planner_lib`) for valid Python package imports.

## Future Enhancements
- Add authentication and authorization for web service endpoints.
- Expand frontend features (filters, search, editing work items).
- Integrate real-time updates via WebSockets.
- Support additional DevOps entities (iterations, teams, etc.).

---
This architecture ensures the project remains maintainable, extensible, and testable as it grows.
