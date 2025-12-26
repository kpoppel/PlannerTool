**PlannerTool Web Architecture**

Purpose: This document describes the architecture, patterns and best-practices for the PlannerTool web app located under `www/`.

**System Overview**
- **Tech stack:** Vanilla JS + ES modules, Lit for web components, Fetch API for data, simple EventBus, no framework-specific router.
- **Design principles:** small, testable services; single shared event bus for decoupled communications; component encapsulation via Lit and Shadow DOM; pluggable provider & plugin layers for extensibility.

**Layered Architecture**
- **Presentation (components):** `www/js/components/*.lit.js` — LitElement components (FeatureCard, MainGraph, Timeline, Sidebar, Modals, etc.). Components render visuals, manage DOM lifecycle, and emit/consume typed events via `EventBus`.
- **Core / Orchestration:** `www/js/core/*` — `EventBus.js`, `EventRegistry.js`, `PluginManager.js`, `Plugin.js`, `ServiceRegistry.js`, `Container.js`. These provide typed events, plugin lifecycle, and module wiring.
- **Services / Domain:** `www/js/services/*` and `www/js/domain/services/*` — `State.js`, `FilterManager.js`, `ScenarioManager.js`, `FeatureService.js`, `CapacityCalculator.js`, `BaselineStore.js`. These encapsulate business logic, state derivation and computations.
- **Data Providers:** `www/js/provider*.js` — `providerREST.js`, `providerLocalStorage.js`, `providerMock.js`. They implement a provider interface used by `dataService.js` to swap backends.
- **Utilities:** `www/js/util.js`, `dragManager.js`, and other helpers used by components and services.

**Component Guide**
- Components are Lit Elements using Shadow DOM for encapsulation. Keep them small and focused: render-only + event handlers.
- Properties vs internal state: Use reactive `static properties` for inputs and attributes; avoid relying on global singletons for rendering where possible — prefer props + events for testability.
- Lifecycle: use `connectedCallback`/`disconnectedCallback` to add/remove external listeners and observers (e.g., ResizeObserver in `FeatureCard`). Always clean up observers and event handlers in `disconnectedCallback`.
- Styling: use component-level CSS and CSS custom properties for theming. Export shared variables (e.g., `--primary-color`) and avoid global CSS bleed. Provide a `theme` contract for plugins.
- Communication: use typed events via `EventRegistry` + shared `bus` instance. Prefer typed-symbol events (e.g., `UIEvents.DETAILS_SHOW`) rather than arbitrary strings. Components should emit domain events (UI action) and listen for derived-state updates.

**State Management**
- Single application-level `state` service (`State.js`) owns baseline data and orchestrates higher-level services (ScenarioManager, FeatureService, CapacityCalculator). It exposes imperative APIs to update features and emits events whenever derived data changes.
- Patterns: Keep baseline data immutable where possible (see `BaselineStore`) and compute derived objects on-demand (`FeatureService.getEffectiveFeatures`). Avoid direct mutation across layers — prefer service APIs that return new objects.
- Selection & filters: `FilterManager` abstracts project/team selection and emits events when selection changes. Scenario filters live in `ScenarioManager`/scenarios stored under state.
- Capacity computation: `CapacityCalculator` receives features + filters + teams/projects and returns per-day capacity; keep heavy computation out of rendering paths and memoize where possible.

**Event System**
- `EventBus` implements a typed-symbol → string mapping via `EventRegistry.EVENT_TYPE_MAP`. Use `bus.on(...)` and `bus.emit(...)` for cross-cutting concerns.
- EventBus supports wildcard listeners (e.g., `feature:*`) and optional history logging for debugging.
- Best practice: components/services should subscribe/unsubscribe in connected/disconnected lifecycle and avoid long-running synchronous handlers that block rendering.

**Plugin System**
- Plugin contract: subclass `core/Plugin.js` and implement `init`, `activate`, `deactivate`, `destroy`.
- PluginManager responsibilities: register, unregister, dependency-checking, load-from-config and activation ordering. Plugins should declare metadata including `id`, `dependencies`, and optional `enabled` in `modules.config.json` (or `config.modules`).
- Hooks: plugins may register EventBus listeners, register UI components (via DOM insertion or Container/ServiceRegistry), or provide service implementations (provider pattern). Keep plugin side-effects reversible so `deactivate`/`destroy` can clean up.
- Configuration: prefer module-based config with explicit `path` and `export` (see PluginManager.loadFromConfig) so plugins can be loaded via dynamic `import()`.

**Provider Pattern (Data Layer)**
- Data provider interface: methods like `getProjects()`, `getTeams()`, `getFeatures()`, `listScenarios()`, `saveScenario()`, `getConfig()` and `getCapabilities()`.
- Implementations: `ProviderREST` (HTTP backed), `ProviderLocalStorage` (local fallback), `ProviderMock` for tests. Wire provider via `dataService.js` (the adapter) so consumers use a consistent API and providers are swappable.

**Testing Strategy**
- Unit tests: Keep services and domain logic (ScenarioManager, FeatureService, CapacityCalculator, FilterManager) fully unit-tested. Avoid DOM in these tests.
- Component tests: Use `@web/test-runner` or Playwright to render Lit components in a headless browser and assert DOM, attributes, and events. Mock `bus` and `state` where possible to isolate components.
- Integration tests: tests that exercise `dataService` + providers + `state` to ensure full wiring. Use `ProviderLocalStorage` or `providerMock` to avoid network calls.
- E2E tests: Playwright configured already — use `npx playwright test` for smoke/regression. Focus on critical flows (load baseline, open details, create scenario, save scenario, drag/resize).
- Coverage goals: aim for 80% statements/functions and 75% branches for service code. UI components should target high branch coverage for critical visual logic.

**Quality & Maintenance**
- Code organization: keep `core/`, `services/`, `domain/`, `components/`, `providers/` clearly separated. New features should follow the same placement.
- Error handling: services should surface structured errors (instances with `code`/`message`) and avoid silent failures. Event handlers should guard against exceptions and log errors.
- Performance: avoid frequent re-renders; components like `FeatureCard` provide `applyVisuals()` to update geometry without full render. Use requestAnimationFrame or batching for many DOM updates.
- Accessibility: components should expose ARIA roles and keyboard interactions where appropriate (list items, modals). Ensure color contrast and ARIA for dynamic content like modals.

**Development Workflow**
- Setup: repository provides `requirements-dev.txt` for Python tests and `package.json` for JS tests. Use node v16+ and run `npm ci` then `npm test` for JS tests.
- Adding components: create `components/MyThing.lit.js`, export and register custom element, add unit + component tests in `tests/components/`.
- Adding services: implement pure JS modules under `services/` or `domain/services/` with constructor DI where possible (inject bus, stores). Add unit tests in `tests/unit`.
- Plugins: Create under `www/js/plugins/` and add module config entry with `id`, `path`, `export`, `dependencies`, and `enabled`.
  Plugins are disabled by default; set `enabled: true` to activate on load. Ensure plugin cleans up.
- Feature flags: use `config.js` featureFlags to gate breaking changes during migration; aim to remove flags progressively.

**Examples (concise patterns)**
- Component emitting typed event:
  - `this.bus.emit(UIEvents.DETAILS_SHOW, this.feature);`
- Service subscription pattern:
  - `const unsub = bus.on(FeatureEvents.UPDATED, handler);` then `unsub()` in cleanup.
- Plugin skeleton:
  - Subclass `Plugin`, implement `init/activate/deactivate/destroy` and use `bus` and `ServiceRegistry` for integration.

**Migration & Roadmap Notes**
- This document targets the desired architecture. Ongoing migration phases (e.g., Phase 6-12) can be tracked in `PHASE_*` files. Keep ARCHITECTURE.md focused on the target architecture; reference phase docs for transitional details.

**Ownership & Updates**
- Keep `ARCHITECTURE.md` under repo root. Assign maintainers in `CONTRIBUTING.md` for approval of architectural changes; allow community updates via PRs but require reviewer sign-off.

Appendix: Component catalog and responsibilities
- Components (brief):
  - `feature-card-lit` — visual card for a feature, handles drag/resize UI and emits detail events.
  - `feature-board` / `FeatureBoard.lit.js` — container rendering lanes and wiring cards.
  - `MainGraph.lit.js` / `Timeline.lit.js` — timeline and header calculations.
  - `PluginGraph.lit.js` — plugin visualizer (example plugin usage).
  - `Modal.lit.js`, `ConfigModal.*` — modal primitives and specific modals.

For complete component list and line-level responsibilities see `www/js/components/` and the services under `www/js/services/`.

End of document.

**Diagrams**

- **Architecture overview:** `docs/diagrams/architecture-overview.svg` — shows layered separation (Presentation → Core → Services → Providers), EventBus and plugin placement.

- **Component → Event Flow:** `docs/diagrams/component-event-flow.svg` — simplified flow: component emits events to `EventBus`, services handle business logic and request data from providers.

Use these diagrams in PR descriptions and onboarding docs to help new contributors quickly understand the overall layout.

-- Component Catalog (detailed)

- `FeatureCard.lit.js` (`feature-card-lit`)
  - Responsibility: Render a feature card with title, team load badges, start/end dates, and drag/resize affordances. Uses `ResizeObserver` and provides `applyVisuals()` to update geometry without rerendering.
  - Events: emits `UIEvents.DETAILS_SHOW` when clicked.
  - Notes: Heavy DOM interactions; keep logic testable by extracting date/geometry helpers to `util.js`.

- `FeatureBoard.lit.js` (`feature-board`)
  - Responsibility: Container for feature cards; projects feature card instances into slots. Hosts scrolling & layout context.

- `MainGraph.lit.js`
  - Responsibility: Canvas-based rendering for organizational load graphs. Subscribes to `CapacityEvents` and batches re-render via requestAnimationFrame.

- `Timeline.lit.js` (`timeline-lit`)
  - Responsibility: Render timeline header months, expose `renderMonths()` and `scrollToMonth()`. Emits `TimelineEvents.MONTHS` after render.

- `PluginGraph.lit.js` (`plugin-graph`)
  - Responsibility: Example high-complexity plugin UI (SVG mountain view). Reads `state` for effective features and computes daily totals. Shows plugin patterns: own tooltip, export, and open/close UI.

- `Sidebar.lit.js` (`sidebar-lit`)
  - Responsibility: Left-side controls for projects, teams, scenarios, and utilities like color picker. Operates in light DOM intentionally for legacy selectors.

- `DetailsPanel.lit.js` (`details-panel`)
  - Responsibility: Right-side details panel that listens for `UIEvents.DETAILS_SHOW` and shows feature metadata and revert controls.

- `Modal.lit.js`, `ConfigModal.lit.js`, `HelpModal.lit.js`, `Scenario*.lit.js`
  - Responsibility: Modal primitives and specific configuration/dialog flows. Use lazy `import()` in `Sidebar` to open modals.

- `DependencyRenderer.lit.js`
  - Responsibility: Render dependency graph visuals used in details/side panes.

- `ColorPopover.lit.js`
  - Responsibility: Shared color selection popover used by `Sidebar` for project/team color editing. Exposes `ensureInstance()` pattern for singletons.

-- Code examples

1) Minimal Lit component (pattern)

```js
import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';

export class MyWidget extends LitElement {
  static properties = { value: { type: String } };
  static styles = css` :host{display:block;} `;
  constructor(){ super(); this.value = ''; }
  connectedCallback(){ super.connectedCallback(); this._unsub = bus.on('some:event', () => this.requestUpdate()); }
  disconnectedCallback(){ if(this._unsub) this._unsub(); super.disconnectedCallback(); }
  render(){ return html`<div>${this.value}</div>`; }
}
customElements.define('my-widget', MyWidget);
```

2) Plugin skeleton

```js
import Plugin from '../core/Plugin.js';
import { bus } from '../core/EventBus.js';

export default class MyPlugin extends Plugin {
  async init(){ /* register services, attach to ServiceRegistry if present */ }
  async activate(){ /* add UI, subscribe to bus events */ }
  async deactivate(){ /* remove UI, unsubscribe */ }
  async destroy(){ /* final cleanup */ }
}
```

3) Provider (local storage) pattern (example)

```js
export class ProviderLocalStorage {
  async getFeatures(){ return JSON.parse(localStorage.getItem('features')||'[]'); }
  async saveScenario(s){ let arr = JSON.parse(localStorage.getItem('scenarios')||'[]'); /* upsert */ localStorage.setItem('scenarios', JSON.stringify(arr)); return s; }
}
```

-- Code review checklist (web components + services)
- Component responsibilities: small, predictable render; logic extracted to services/util helpers.
- Lifecycle cleanliness: event listeners and observers must be removed in `disconnectedCallback`.
- Typed events: prefer `EventRegistry` symbol constants to string events.
- State mutations: only mutate via service APIs; baseline data should be treated as immutable.
- Accessibility: interactive components have ARIA roles, keyboard support and color contrast checks.
- Tests: unit tests for services, component tests for rendering & events, integration tests for `state` + `dataService`.
- Performance: avoid forcing reflow on every frame; use `applyVisuals()` or batched updates for many DOM changes.

-- Migration appendix (recommendation)

Keep phase migration details in `PHASE_*` docs. In this ARCHITECTURE guide, include only recommended next-phase items:
- Refactor `State.js` into smaller services (some already done: `ScenarioManager`, `FilterManager`).
- Convert remaining legacy DOM wiring into Lit components (Sidebar already uses light DOM by design).
- Remove feature flags progressively; add deprecation notes in `config.js`.

-- End of extended architecture guidance

