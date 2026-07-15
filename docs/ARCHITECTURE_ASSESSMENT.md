# PlannerTool Web Architecture — Assessment

> Companion to [ARCHITECTURE.md](ARCHITECTURE.md). This document (1) rates the `www/js` /
> `www-admin/js` codebase against best-in-class modern web application practice, and (2) documents concrete
> pain points, bloat, and code-reduction opportunities discovered while producing the architecture
> documentation on 2026-07-15.
>
> Context: this application is ~99% LLM-authored. The findings below are used to calibrate expectations for
> the next round of implementation and optimization work — they are observations grounded in the actual
> source, not generic advice.

## 1. Methodology

Five focused, read-only passes were performed over `www/js/application`, `www/js/core`, `www/js/services`
(23 files), `www/js/components` (42 files), `www/js/plugins` (13 plugins + 3 helper subfolders), and
`www-admin/js` in full, cross-referenced against `wc -l` measurements and the existing repo-memory
refactor log (`memories/repo/code-reduction-plan.md`, `State-architecture-analysis.md`). Ratings below are
relative to mainstream 2025/2026-era production SPA practice (React/Vue/Svelte + TS + a bundler + a typed
state library + component testing), not against an arbitrary ideal.

## 2. Scorecard vs. best-in-class modern web application practice

| Category | Rating (1–5) | Rationale |
|---|---|---|
| **State management architecture** | 4/5 | `AppStore` (immutable snapshots, labeled transactions, selector subscriptions) + commands/selectors separation is a legitimate, well-executed Redux-like pattern hand-rolled without a dependency. Comparable in rigor to Zustand/Redux Toolkit. Loses a point for zero schema validation on state shape and lingering mutable runtime caches whose canonical-vs-derived boundary isn't documented in code (only in repo memory). |
| **Component architecture (Lit)** | 3/5 | Consistent lifecycle discipline (subscribe/unsubscribe pairs), a real `Modal.lit.js` base class, and clean CSS state machines. Loses points for two ~2,000-line "God components" (`DetailsPanel.lit.js`, `Sidebar.lit.js`) that mix five-plus concerns each — the opposite of the single-responsibility principle the rest of the codebase follows. |
| **Type safety** | 1/5 | Pure JavaScript, sparse JSDoc, no TypeScript, no runtime schema validation (no Zod/io-ts) anywhere on the AppStore boundary or the REST provider boundary. For a codebase this large (58k+ LOC across both apps) this is the single largest gap vs. best-in-class practice — most drift bugs recorded in `testing-notes.md` (getter-vs-property mismatches, Set-vs-Array shape decisions) are exactly the class of bug a type system catches at compile time. |
| **API/module boundary discipline** | 4/5 | The `PlannerApi` v1 namespaced facade, enforced by a custom `guard:runtime-state` lint script, is a genuinely good pattern — better than most hand-rolled SPAs, which typically leak internals everywhere. The recent removal of the legacy top-level mirror (Part 3) is real, verified progress. |
| **Testing strategy** | 3/5 | Vitest + Playwright + component tests + a static architecture guard script is solid tooling. Coverage is uneven: large algorithmic services (`CapacityCalculator`, `SwimlaneService`, `FeatureService` date-shift logic) were not confirmed to have dedicated unit tests during this pass, and `testing-notes.md` shows a history of tests coupled to internal shapes rather than behavior. |
| **Build tooling / DX** | 3/5 | Vite + Rollup + ESLint + Prettier is a modern, appropriate toolchain — better than the "no bundler" state described in the legacy doc. Still no bundle-size budget, no code-splitting strategy visible for the ~19k-LOC plugin tree (all plugins ship as part of the same `www/js` tree; only a handful use dynamic `import()` for lazy loading), and no CI-visible lint/type gate beyond the runtime-state guard. |
| **Plugin/extension architecture** | 2/5 | The concept (declarative metadata + versioned API injection + exclusivity/fullscreen semantics) is sound and well thought out. Execution is inconsistent: of 13 plugins, only 3 extend the `OverlayPlugin` base class; the other 10 hand-roll near-identical mount-point resolution and fullscreen show/hide logic. This is the clearest "LLM wrote each plugin independently without checking siblings" symptom in the codebase. |
| **Admin panel architecture** | 3/5 | Reasonable, simple tab-based SPA with a solid schema-driven form generator (`SchemaForm.lit.js`). Duplicates a full REST client and Result-handling philosophy from the main app instead of sharing a package, and contains at least one apparently dead component (`AzureDevOps.lit.js`, not wired into any section). |
| **Performance architecture** | 3/5 | Deliberate incremental-recompute strategies exist (`CapacityCalculator` delta cache, `Timeline.lit.js` coalesced/idle-callback scheduling, `BoardCoordinateService` scroll-only fast path). Undermined by JSON.stringify/parse "deep clone" patterns in several services (`BaselineStore`, `PluginStateService`) where `structuredClone()` or `Object.freeze` would be both faster and safer, and by full-snapshot recompute triggers in `MainGraph.lit.js` on any state change. |
| **Security posture** | 3/5 | Session-cookie + header (`X-Session-Id`) auth with 401-triggered reacquisition is reasonable. No CSP evidence reviewed in this pass; provider error messages surfaced via a custom `X-Tasks-Warning-Message` response header is an unusual, easy-to-miss pattern worth revisiting. Out of scope for a deep security review in this pass — flagged for a dedicated audit. |
| **Overall** | **3/5 — solid, over-custom, under-typed** | The architecture is *better engineered* than a typical vibe-coded SPA (real state discipline, real API boundary enforcement, real lint guards) but *carries more hand-rolled infrastructure and per-file inconsistency* than a team using an established framework + TypeScript would need to carry. The gap to "best-in-class" is concentrated in type safety and plugin/component consistency, not in the core state-management design, which is genuinely good. |

## 3. Concrete pain points (grounded in source, prioritized by leverage)

### 3.1 Two ~2,000-line "God components" — highest UI leverage

- **`DetailsPanel.lit.js` (2,079 LOC, the largest file in `www/js`)** mixes header/status, scheduling +
  iteration-override detection, capacity allocation editing, tags, and relations/links rendering in one
  file. Natural split: `<feature-scheduling>`, `<feature-capacity>`, `<feature-relations>`, `<feature-tags>`,
  with `DetailsPanel` becoming a thin composition shell (~300–400 LOC).
- **`Sidebar.lit.js` (1,978 LOC)** mixes project/team/scenario/view chip lists, the data-funnel metrics
  panel, expansion controls, task filters, and taskboard display options. Natural split:
  `<task-filters-panel>`, `<expand-dataset-panel>`, `<taskboard-options-panel>`.
- **Estimated impact**: -1,500 to -2,000 LOC net (some duplication of prop-passing offsets the split), large
  gain in testability (today these are two of the hardest files in the repo to unit test in isolation).

### 3.2 Plugin entry-file boilerplate duplication — highest reduction/consistency leverage

10 of 13 plugins hand-roll the same three things instead of extending a shared base:
1. Mount-point DOM resolution (`document.querySelector('#'+mp) || document.querySelector('.'+mp) ||
   document.body`) — duplicated verbatim in ~8 files.
2. Fullscreen show/hide of `#timeline-board` (save/restore `style.display`) — duplicated in 5 files
   (Portfolio, Cost, ExportTimeline, Graph, XYBoard).
3. Lazy component import + element creation + `api` property assignment — duplicated in ~10 files.

**Recommendation**: introduce `DomMountedPlugin` (mount-point resolution + component lazy-load) and
`FullscreenPlugin` (visibility save/restore) base classes/mixins extending `Plugin`, and migrate all 13
entry files onto them. **Estimated impact**: -300 to -400 LOC, and closes the "PluginManager can't reason
about arbitrary manual-lifecycle plugins uniformly" gap.

### 3.3 Type safety is the largest structural gap

Every drift bug documented in `memories/repo/testing-notes.md` (getter-vs-plain-property mismatches on
`state.projects`/`state.expansionState`, Set-vs-Array `selectedFeatureStateFilter` shape decisions, the
`{schema_version, plugins}` vs. flat-array plugin-config payload confusion) is a class of bug a type system
(TypeScript, or at minimum JSDoc `@typedef` + `tsc --checkJs` in CI) would catch before runtime. Given
AGENTS.md explicitly forbids converting modules to TypeScript "without an explicit task," the pragmatic
near-term step is:
- Add `@typedef` JSDoc for the `AppStore` state shape (Section 4.2 of ARCHITECTURE.md) and for
  `PlannerApi`'s namespaced return shapes, then run `tsc --checkJs --noEmit` in CI as a non-blocking check.
- This requires no rewrite, no build-tool change, and directly targets the bug class actually seen in this
  repo's history.

### 3.4 Defensive/legacy-migration residue not yet cleaned up

- `PlannerApi.js` and `createPlannerCommands.js` retain comments describing "staged migration" /
  "transitional" behavior (e.g., `plannerApplication.initialize()` in `app.js`) even though the migration
  (`State.js` deletion, Parts 1–4 of the code-reduction plan) is complete. These comments are now
  misleading and should be updated or removed as part of the Part 5 cleanup already in progress.
- `buildDefaultScenarioCloneName()`-equivalent logic and view-option normalization exist in more than one
  place (`createPlannerCommands.js` and `createPlannerRuntimeServices.js`); low LOC impact (~20–40 lines)
  but a real drift risk if only one copy is updated in a future change.
- Feature flags `USE_LIT_COMPONENTS` and `USE_PLUGIN_SYSTEM` gate migrations that are 100% complete
  (every component is Lit; the plugin system is the only extension mechanism) — they can be deleted along
  with their now-dead `false` branches.

### 3.5 Excessive defensive coding / silent failure patterns

Consistent with "99% LLM-authored, high likelihood of extra guards": every services-layer report and the
components report independently flagged the same pattern — `try { ... } catch (e) { console.warn(...) }`
with no user-facing surface, repeated across `DataInitService`, `ConfigService`, `TaskFilterService`,
`Sidebar.lit.js`, and `DetailsPanel.lit.js`. None of these were found to guard against a documented failure
mode; they read as reflexive LLM output rather than intentional error handling (violates this repo's own
`AGENTS.md` rule: "Only create try/catch paths if and only if there is a real failure path warranting
this."). **Recommendation**: audit and remove catches that don't correspond to a real, documented failure
path; where a real failure exists, surface it via the existing session/error banner pattern instead of
`console.warn`.

### 3.6 Inconsistent cloning/immutability primitives

`BaselineStore.js` and `PluginStateService.js` use `JSON.parse(JSON.stringify(x))` for defensive copies,
while `AppStore.js` correctly uses `Object.freeze` + structural equality. `structuredClone()` (available in
all supported browsers) is both faster and handles more types correctly (Dates, Maps) than the
JSON round-trip. Low LOC impact, moderate correctness/perf benefit.

### 3.7 Large, dense algorithmic files without visible dedicated unit tests

`CapacityCalculator.js` (543 LOC — feature-first daily capacity algorithm with epic/child precedence and
an incremental delta-application code path that duplicates the full-calculation code path),
`FeatureService.js`'s date-shift/expansion methods, and `SwimlaneService.assignFeatureToSwimlane()` (~115
lines of nested parent-chain-walking conditionals) are the highest-complexity, highest-risk-of-regression
code in the app. This pass did not find dedicated focused unit-test files for the delta-cache path
specifically. **Recommendation**: before any further refactor of these files, add characterization tests
pinning current behavior (this mirrors the discipline already used well elsewhere in the repo's
code-reduction plan, which requires "targeted behavioral tests" before every slice).

### 3.8 Admin/main app duplication

`www-admin/js` reimplements a REST client, a schema-driven form philosophy, and Result-style error handling
independently of `www/js`. The isolation is architecturally defensible (different auth model, no
EventBus/plugin needs), but the `result.js` Result-type helpers (`ok/fail/asResult/dataOr`, 79 LOC) and
basic `fetch` + JSON error-shape handling could be extracted into a small shared utility module imported by
both apps without re-coupling their domain logic. Low LOC impact (~100–150 lines removed), but removes a
maintenance trap (two independently-evolving copies of the same small idea).

## 4. Framework/library alternatives — is the hand-rolled stack still justified?

| Concern | Current approach | Established alternative | Verdict |
|---|---|---|---|
| Component model | Lit web components | React/Vue/Svelte | **Keep Lit.** Native custom elements avoid framework lock-in and work well with the plugin architecture (plugins register real custom elements, not framework-specific components). No evidence this is a pain point. |
| State management | Hand-rolled `AppStore` + commands/selectors | Redux Toolkit, Zustand, Jotai, MobX | **Keep the pattern, question the hand-rolling.** The architecture already *is* a Redux-like store; a library like Zustand or Redux Toolkit would provide the same immutability/selector/subscription guarantees with far less bespoke code (`AppStore.js` reimplements deep-freeze, structural equality, and transaction labeling that RTK's `createSlice`/`immer` gives for free) and with DevTools time-travel debugging out of the box. This is a "buy vs. build" call best made by the team, not a mandatory change — the current code works and is well-tested — but it is the single biggest opportunity to delete hand-rolled infrastructure if a rewrite is ever justified. |
| Type safety | None | TypeScript | **Adopt incrementally per Section 3.3.** Given AGENTS.md's explicit "no TS conversion without an explicit task" rule, the realistic near-term move is JSDoc `@typedef` + `tsc --checkJs`, not a rewrite. |
| Data fetching | Hand-rolled `providerREST.js` + `dataService.js` | TanStack Query / SWR | **Not obviously worth it.** The domain has bespoke session/retry semantics already implemented correctly; a fetching library would mostly replace already-working code without addressing this repo's actual pain points (plugin duplication, God components, missing types). |
| Plugin system | Hand-rolled `PluginManager`/`Plugin` | None widely applicable (this is a domain-specific extension model) | **Keep, but fix internal consistency (Section 3.2).** No off-the-shelf library replaces a domain-specific mount-point/exclusivity/fullscreen model like this one. |
| Build tooling | Vite + Rollup | Already best-in-class | No change needed. |

**Bottom line**: this is not a codebase that needs a framework migration. It needs (1) type safety added
incrementally, (2) two components split, (3) plugin boilerplate consolidated into shared base classes, and
(4) a pass to remove now-stale migration residue and reflexive defensive code. All four are additive,
low-risk, and can be sequenced independently — none requires touching the (well-designed) `AppStore` /
commands / selectors core.

## 5. Prioritized code-reduction backlog

| # | Item | Est. LOC impact | Risk | Depends on |
|---|---|---|---|---|
| 1 | Split `DetailsPanel.lit.js` into 4 sub-components | −1,000 to −1,500 | Medium (high test surface) | None |
| 2 | Split `Sidebar.lit.js` into 3 sub-components | −500 to −800 | Medium | None |
| 3 | Introduce `DomMountedPlugin` + `FullscreenPlugin` base classes; migrate 10 plugin entry files | −300 to −400 | Low-medium | None |
| 4 | Remove stale "staged migration" comments/branches (`USE_LIT_COMPONENTS`, `USE_PLUGIN_SYSTEM` dead branches, duplicate scenario-name-generation) | −50 to −100 | Low | Part 5 of code-reduction-plan.md |
| 5 | Audit and remove non-load-bearing `try/catch` blocks (Section 3.5) | −100 to −200 | Low-medium (must confirm no real failure path first) | Characterization tests where behavior is genuinely uncertain |
| 6 | Replace `JSON.parse(JSON.stringify(...))` clones with `structuredClone()` in `BaselineStore`/`PluginStateService` | ~0 net (perf/correctness win, not size) | Low | None |
| 7 | Extract shared Result-helper module reused by `www-admin` | −100 to −150 | Low | None |
| 8 | Add `@typedef` JSDoc for `AppStore` state + `PlannerApi` returns, enable `tsc --checkJs` in CI (non-blocking) | +200 to +400 (additive, JSDoc) | Low | None |

Items 1–3 are the highest-leverage, lowest-risk reductions and are recommended as the next implementation
slices after this documentation baseline. Items 4–7 are good "quick win" cleanup candidates. Item 8 is
additive but directly targets this repo's most common class of recorded regression.
