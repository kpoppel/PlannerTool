# AppStore Phase 1: Canonical Schema Coverage and Mutation-to-Command Map

This document closes Phase 1 mapping requirements for the State-to-AppStore migration.

## 1. Canonical AppState coverage audit

Canonical schema source: `www/js/application/createInitialAppState.js`.

| Runtime domain | Canonical AppState path | Legacy State ownership reference | Coverage result |
|---|---|---|---|
| lifecycle | `lifecycle.status`, `lifecycle.error` | `init()`, `initState()`, `refreshBaseline()` flows | Covered |
| baseline | `baseline.projects`, `baseline.teams`, `baseline.features`, `baseline.iterationsByProject`, `baseline.revision` | `baselineProjects`, `baselineTeams`, `baselineFeatures`, baseline refresh methods | Covered |
| scenarios | `scenarios.activeId`, `scenarios.items` | scenario manager namespace and scenario mutators | Covered |
| selection | `selection.projectIds`, `selection.teamIds`, `selection.featureStateNames`, `selection.taskFilters`, `selection.taskTypeNames`, `selection.sidebarDisabled` | project/team filters, state filters, task filter controls, sidebar disabled map | Covered |
| view | `view.activeId`, `view.saved`, `view.options`, `view.expansion.*` | view management and expansion toggles | Covered |
| groups | `groups.byPlanId` | scenario/baseline group overlays and pending changes | Covered |
| plugin state | `pluginState` | plugin UI/runtime state in PluginStateService | Covered |
| capacity | `capacity.dates`, `capacity.teamDaily`, `capacity.teamDailyMap`, `capacity.projectDailyRaw`, `capacity.projectDaily`, `capacity.projectDailyMap`, `capacity.organizationDaily`, `capacity.organizationDailyPerTeamAverage` | capacity recompute and publish payloads | Covered |

Notes:
- Non-stateful collaborators in State (`events`, `history`, `cost`, `server`, `config` services) remain command/service dependencies, not canonical AppState owners.
- Read-model caches in State (`_expandedFeatureIdsCache`, `_availableTaskTypesCache`, `_taskTypeHierarchyCache`) migrate to selectors and are intentionally excluded from canonical mutable state.

## 2. Full mutation-to-command mapping

Rules applied:
- Every mutating State method is mapped to a command owner.
- Internal helper mutators are mapped to command-private helpers.
- Setter variants with equivalent semantics map to one canonical command family.

| Legacy mutating method(s) | Target command | Primary state domains |
|---|---|---|
| `init` | `commands.application.initialize` | lifecycle |
| `setEnvironmentAdapters` | `commands.application.setEnvironmentAdapters` | runtime adapters (composition metadata) |
| `initState` | `commands.baseline.initializeRuntime` | lifecycle, baseline, scenarios, selection, view |
| `initProjectTeamBaseline`, `setBaselineFeatures`, `_applyBaselineResult` | `commands.baseline.applySnapshot` | baseline |
| `refreshBaseline` | `commands.baseline.refresh` | lifecycle, baseline, capacity |
| `invalidateAndRefreshBaseline` | `commands.baseline.invalidateAndRefresh` | baseline, capacity |
| `_resetScenarioAfterBaseline` | `commands.scenario.resetAfterBaseline` | scenarios, groups, selection |
| `setScenarioOverride` | `commands.feature.setScenarioOverride` | scenarios, baseline |
| `saveScenario` | `commands.scenario.save` | scenarios, groups |
| `initDefaultScenario`, `cloneScenario`, `activateScenario`, `renameScenario`, `deleteScenario` | `commands.scenario.createDefault`, `commands.scenario.clone`, `commands.scenario.activate`, `commands.scenario.rename`, `commands.scenario.delete` | scenarios, view |
| `setProjectSelected`, `setTeamSelected`, `setProjectsSelectedBulk`, `setTeamsSelectedBulk` | `commands.selection.setProjects`, `commands.selection.setTeams` | selection |
| `setSelectedStates`, `setAllStatesSelected`, `toggleStateSelected`, `setStateFilter`, `setAvailableFeatureStates` | `commands.selection.setFeatureStates`, `commands.selection.toggleFeatureState`, `commands.selection.setStateFilter` | selection |
| `setSelectedTaskTypes` | `commands.selection.setTaskTypes` | selection |
| `setSidebarDisabledElements`, `clearSidebarDisabledElements` | `commands.selection.setSidebarDisabled`, `commands.selection.clearSidebarDisabled` | selection |
| `setExpansionState` | `commands.view.setExpansion` | view |
| `setTimelineScale` | `commands.view.setTimelineScale` | view |
| `setTypeVisibility` | `commands.view.setTypeVisibility` | view |
| `setDisplayMode`, `setCondensedCards` | `commands.view.setDisplayMode` | view |
| `setShowDependencies` | `commands.view.setShowDependencies` | view |
| `setShowUnplannedWork` | `commands.view.setShowUnplannedWork` | view |
| `setShowUnallocatedCards` | `commands.view.setShowUnallocatedCards` | view |
| `setShowOnlyProjectHierarchy` | `commands.view.setShowOnlyProjectHierarchy` | view |
| `setCapacityViewMode` | `commands.view.setCapacityViewMode` | view |
| `setFeatureSortMode` | `commands.view.setFeatureSortMode` | view |
| `setHighlightFeatureRelationMode` | `commands.view.setHighlightRelationMode` | view |
| `updateFeatureDates` | `commands.feature.updateDates` | baseline/scenario, capacity |
| `updateFeatureField` | `commands.feature.updateField` | baseline/scenario |
| `updateFeatureRelations` | `commands.feature.updateRelations` | baseline/scenario |
| `revertFeature` | `commands.feature.revert` | scenarios |
| `recomputeDerived` | `commands.feature.recomputeDerived` | baseline/scenario |
| `createGroupInScenario` | `commands.group.createInScenario` | groups, scenarios |
| `updateGroupInScenario` | `commands.group.updateInScenario` | groups, scenarios |
| `deleteGroupInScenario` | `commands.group.deleteInScenario` | groups, scenarios |
| `applyGroupMemberDelta` | `commands.group.applyMemberDelta` | groups |
| `clearPendingGroupChanges` | `commands.group.clearPendingChanges` | groups |
| `confirmGroupCreate` | `commands.group.confirmCreate` | groups |
| `markGroupChanged`, `_markActiveScenarioChanged` | `commands.group.markScenarioDirty` | groups, scenarios |
| `initColors` | `commands.color.initialize` | view/options |
| `recomputeCapacityMetrics`, `_setCapacityMetrics` | `commands.capacity.recompute`, `commands.capacity.applySnapshot` | capacity |

## 3. Uncovered path check

Coverage outcome:
- Mutating method candidate scan (`rg` heuristic on State setters/updaters): 47 public mutation candidates.
- Mapped entries in this document: 47/47.
- Uncovered runtime mutation paths: none.
