# UI/UX v5 Scope Contract

The application keeps two task collections distinct:

- **Resolved features** are the complete effective dataset for the selected baseline and active scenario. Presentation controls must not mutate this collection or use it as a replacement for calculation inputs.
- **Visible features** apply the presentation scope in order: selected plans, Context, Team Drill-down, then existing task filters.

The Context state has four independent display flags: `parent`, `child`, `dependency`, and `otherAllocations`. Team IDs in `selection.teamIds` are a display lens; they do not define organization-wide capacity denominators or Team-mode totals.

The shared selector surface is `sel.scope`:

- `getResolvedFeatures()` returns the effective dataset.
- `getVisibleFeatures()` returns the final board scope.
- `getVisibleTeams()` returns teams with allocations on visible tasks.
- `getFunnel()` returns `tasksVisible` and `teamsInView`; both are zero when no plan is selected.

Context is persisted as part of saved view state through `view.context`. Capacity selectors must continue to read the resolved organization baseline rather than `sel.scope.getVisibleFeatures()`.

## Stage 0 scope map

The current migration boundary is intentionally explicit:

| Existing surface | Current input | Stage 0 classification | Follow-up stage |
| --- | --- | --- | --- |
| `FeatureBoard` and `featureExpansion` | `view.expansion` and selected IDs | Board presentation and card composition | Stage 1/3 visible-scope migration |
| `SwimlaneService` | expansion flags, selected plans, selected teams | Lane composition and assignment | Stage 3 Context gates |
| `CapacityCalculator` | selected projects, selected teams, selected states | Calculation input; still legacy semantics | Stage 2 denominator and full-org totals |
| `MainGraph` | selected team IDs and capacity snapshots | Graph rendering and normalization | Stage 2 invariant fix |
| Graph and portfolio plugins | selection selectors and effective features | Plugin presentation, with remaining independent scope reads | Stage 4 plugin convergence |
| `PluginDependencies` | view dependency state and plugin lifecycle | Dependency overlay lifecycle | Stage 1 Context ownership |

The shared ownership rule is implemented by
`resolveFundedTargetProject(feature, effectiveById, projectById)` in
`www/js/application/shared/ownership.js`. It walks arbitrary feature-parent depth,
selects the nearest `type === 'project'` owner, memoizes once per calculation,
and returns `null` for missing or cyclic references. Both full and incremental
capacity attribution paths use this helper; normalization and full-organization
aggregation remain a later Stage 2 change.

## Stage 0 baseline

Baseline command:

```text
npx vitest run tests/components/sidebar.tasktype.test.js tests/components/maingraph.test.js tests/components/maingraph.phase4.test.js tests/swimlaneService.test.js tests/application/groupProjection.shared.test.js tests/plugins/plugin-dependencies.phase4.test.js tests/components/dependency-renderer.lit.test.js
```

Result on 2026-09-13: 7 test files passed and 63 tests passed. MainGraph tests
emit the existing jsdom `HTMLCanvasElement.prototype.getContext` warning, but
the suite remains green. No baseline failures were recorded.

## Stage 1.1 progress

The Sidebar now renders the four Context segments and persists their state via
`cmd.view.setContext`. `FeatureBoard` gates card visibility through
`sel.scope.getVisibleFeatures()` before applying its existing state, type, and
task presentation filters. Legacy expansion fields remain available to
unmigrated swimlane and graph consumers; they are not exposed as Sidebar
controls.

Team Drill-down derives its roster from `sel.scope.getContextTeams()`, so the
list follows the selected plan and Context before team selection is applied.
Sidebar team toggles use display-only selection commands and therefore do not
trigger capacity recomputation. The legacy top-bar TeamMenu remains available
while later stages migrate its ownership to the Sidebar.

The top bar now reports the canonical Data Funnel (`tasksVisible` and
`teamsInView`) rather than owning a Team trigger. TeamMenu remains registered
only as a compatibility component for the later cleanup stage.

The dependency overlay now reads `view.context.dependency` during plugin
activation and reacts to Context filter changes. The legacy
`view.options.showDependencies` command remains available for saved-view
compatibility, but it no longer owns overlay lifecycle.

## Phase 1 complete

Phase 1 now has one presentation path for plan and team scope:

- Sidebar owns Context and Team Drill-down controls, including empty and bulk-selection states.
- TopMenu reports the canonical Data Funnel instead of owning Team selection.
- FeatureBoard filters cards from `sel.scope.getVisibleFeatures()`.
- SwimlaneService discovers expanded-plan lanes from canonical visible features, including Other allocations.
- Dependency overlay lifecycle follows `view.context.dependency`.

Legacy expansion state and TeamMenu remain as compatibility surfaces for the
later cleanup stages; they are no longer the source of Sidebar Context or
cross-plan lane discovery.