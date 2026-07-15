/**
 * FeatureBoard.init.js
 *
 * Board initialisation wiring: subscribes to bus events, loads groups for
 * selected plans, and handles connected-set navigation.
 *
 * Extracted from FeatureBoard.lit.js to keep the component file focused on
 * rendering and Lit lifecycle.
 *
 * Re-exported from FeatureBoard.lit.js so consumers can continue to import
 * initBoard from either path:
 *   import { initBoard } from './FeatureBoard.lit.js';         // original path
 *   import { initBoard } from './FeatureBoard.init.js';        // direct path
 */
import {
  ProjectEvents,
  TeamEvents,
  TimelineEvents,
  FeatureEvents,
  FilterEvents,
  ScenarioEvents,
  ViewEvents,
  AppEvents,
  UIEvents,
  GroupEvents,
} from '../core/EventRegistry.js';
import { bus } from '../core/EventBus.js';
import { applicationApi as state } from '../application/plannerApplication.js';
import { groupService } from '../services/GroupService.js';
import { findInBoard } from './board-utils.js';

export async function initBoard() {
  const board = findInBoard('feature-board');
  if (!board) {
    console.warn('feature-board element not found');
    return;
  }

  let _boardReady = false;
  const renderFeatures = () => {
    if (!board || !_boardReady) return;
    if (typeof board.renderFeatures === 'function') board.renderFeatures();
  };

  const updateFeatures = (payload) => {
    if (!board || !_boardReady || typeof board.updateCardsById !== 'function') return;
    const ids = payload?.ids;
    if (Array.isArray(ids) && ids.length > 0) {
      board.updateCardsById(ids);
    } else {
      board.renderFeatures();
    }
  };

  const handleScenarioActivation = ({ scenarioId }) => {
    if (!board) return;
    const activeScenario = state.scenarios.list().find((s) => s.id === scenarioId);
    // Apply scenario-mode class on #board-area (the background container) so
    // the correct stripe colour is shown.
    const boardArea = findInBoard('#board-area');
    if (activeScenario && !activeScenario.readonly) {
      board.classList.add('scenario-mode');
      boardArea?.classList.add('scenario-mode');
    } else {
      board.classList.remove('scenario-mode');
      boardArea?.classList.remove('scenario-mode');
    }
  };

  bus.on(ProjectEvents.CHANGED, renderFeatures);
  bus.on(TeamEvents.CHANGED, renderFeatures);
  bus.on(TimelineEvents.MONTHS, renderFeatures);
  bus.on(TimelineEvents.SCALE_CHANGED, renderFeatures);
  bus.on(FeatureEvents.UPDATED, updateFeatures);
  bus.on(FilterEvents.CHANGED, renderFeatures);
  bus.on(ViewEvents.SORT_MODE, renderFeatures);
  bus.on(ScenarioEvents.ACTIVATED, handleScenarioActivation);
  // Re-render whenever groups are loaded or mutated
  bus.on(GroupEvents.LOADED, renderFeatures);
  bus.on(GroupEvents.CHANGED, renderFeatures);

  // Load groups for newly-selected plans whenever the project selection changes.
  // We only fetch plans that are NOT already in the local cache.  Skipping
  // already-loaded plans is intentional: it prevents the fetch from overwriting
  // locally-created (pending / unsaved) groups that have not yet been persisted
  // to the server.  When a plan is deselected its cache entry is evicted so
  // the next selection always triggers a fresh fetch.
  const loadGroupsForSelectedPlans = () => {
    const selected = state.selection.getProjects().filter((p) => p.selected);
    for (const plan of selected) {
      if (!groupService.hasPlanLoaded(plan.id)) {
        groupService.loadGroups(plan.id).catch((err) =>
          console.warn('[initBoard] loadGroups failed for plan', plan.id, err)
        );
      }
    }
  };
  // Evict the cache for plans that become de-selected so the next time the plan
  // is selected its groups are fetched fresh from the server.
  const evictDeselectedPlans = () => {
    const selectedIds = new Set(state.selection.getProjects().filter((p) => p.selected).map((p) => String(p.id)));
    for (const plan of state.selection.getProjects()) {
      if (!selectedIds.has(String(plan.id)) && groupService.hasPlanLoaded(plan.id)) {
        groupService.evictPlan(plan.id);
      }
    }
  };
  bus.on(ProjectEvents.CHANGED, () => {
    evictDeselectedPlans();
    loadGroupsForSelectedPlans();
  });

  // Connected-set handling: request, selection within set, and clear on details hide
  bus.on(FeatureEvents.REQUEST_CONNECTED_SET, (feature) => {
    if (!board) return;
    const set = board._computeConnectedSet(feature);
    board._connectedSet = set;
    board._connectedPrimary = String(feature.id);
    board._connectedCurrent = String(feature.id);
    bus.emit(FeatureEvents.CONNECTED_SET_UPDATED, {
      ids: set,
      primary: board._connectedPrimary,
      current: board._connectedCurrent,
    });
  });

  bus.on(FeatureEvents.SELECTED_IN_CONNECTED_SET, (feature) => {
    if (!board || !board._connectedSet || board._connectedSet.length === 0) return;
    const id = String(feature.id);
    board._connectedCurrent = id;
    bus.emit(FeatureEvents.CONNECTED_SET_UPDATED, {
      ids: board._connectedSet,
      primary: board._connectedPrimary,
      current: board._connectedCurrent,
    });
    bus.emit(FeatureEvents.SELECTED, feature);
  });

  bus.on(UIEvents.DETAILS_HIDE, () => {
    if (!board) return;
    board._connectedSet = [];
    board._connectedPrimary = null;
    board._connectedCurrent = null;
    bus.emit(FeatureEvents.CONNECTED_SET_UPDATED, {
      ids: [],
      primary: null,
      current: null,
    });
  });

  bus.once(AppEvents.READY, () => {
    _boardReady = true;
    loadGroupsForSelectedPlans();
    renderFeatures();
  });
}
