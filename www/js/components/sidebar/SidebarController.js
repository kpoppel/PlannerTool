import { sel } from '../../application/imports.js';
import { isStoreReady } from '../../application/store.js';
import { StoreController } from '../../core/StoreController.js';
import { bus } from '../../core/EventBus.js';
import { BoardEvents, FeatureEvents } from '../../core/EventRegistry.js';
import { SIDEBAR_FILTER_DIMENSIONS } from './SidebarTaskFilters.lit.js';
import { featureTypeKey } from '../../application/shared/workItemDisplay.js';

function selectDependencies(state) {
  return { baseline: state.baseline, selection: state.selection, view: state.view,
    scenarios: state.scenarios, lifecycle: state.lifecycle };
}

function equalDependencies(previous, next) {
  return previous.baseline === next.baseline && previous.selection === next.selection &&
    previous.view === next.view && previous.scenarios === next.scenarios &&
    previous.lifecycle === next.lifecycle;
}

/** Project state and own board subscriptions, queued frames, and health requests. */
export class SidebarController {
  constructor(host) {
    this.host = host;
    this.connection = 0;
    this._connected = false;
    this._subscriptions = [];
    this._frame = null;
    this._snapshot = null;
    this._store = new StoreController(host, selectDependencies, { equalityFn: equalDependencies });
    host.addController(this);
  }

  hostConnected() {
    this.connection += 1;
    this._connected = true;
    this._snapshot = null;
    this._subscriptions = [
      bus.on(BoardEvents.FOLD_STATE, ({ active, foldedCount, foldableCount, canCollapse }) => {
        this.host.foldActive = active;
        this.host.foldedCount = foldedCount;
        this.host.foldableCount = foldableCount;
        this.host.canCollapse = canCollapse;
      }),
      bus.on(FeatureEvents.UPDATED, () => this.scheduleRefresh()),
    ];
    this.host.requestUpdate();
  }

  hostUpdate() {
    const next = this._store.value;
    if (next === this._snapshot) return;
    const previous = this._snapshot;
    this._snapshot = next;
    if (!isStoreReady()) return;
    if (previous === null || previous.lifecycle.status !== 'ready' || previous.baseline !== next.baseline ||
      previous.selection.teamIds !== next.selection.teamIds) this.host.teams = sel.selection.getTeams();
    this.scheduleRefresh();
  }

  hostDisconnected() {
    this._connected = false;
    this.connection += 1;
    for (const unsubscribe of this._subscriptions) unsubscribe();
    this._subscriptions = [];
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._frame = null;
  }

  scheduleRefresh() {
    if (this._frame !== null) return;
    const connection = this.connection;
    this._frame = requestAnimationFrame(() => {
      if (!this._connected || connection !== this.connection) return;
      this._frame = null;
      this.host.requestUpdate();
    });
  }

  getPresentationModel(teams) {
    const taskTypes = sel.feature.getAvailableTaskTypesOrdered();
    const features = sel.scope.getPresentableContextFeatures();
    const scopedTypes = new Set(features.map(featureTypeKey));
    const scopedStates = new Set(features.map((feature) => feature.state));
    const filters = sel.filter.getTaskFilters();
    const colors = sel.filter.getFeatureStateColors();
    const selectedStates = sel.filter.getSelectedFeatureStateSet();
    const teamCounts = new Map(teams.map((team) => [team.id, sel.feature.getCountsForTeam(team.id)]));
    const nonemptyTypes = taskTypes.filter((type) =>
      teams.some((team) => teamCounts.get(team.id).get(type) > 0));
    const visibleTypes = nonemptyTypes.slice(0, this.host.teamCountsOpen ? nonemptyTypes.length : 2);
    return {
      teams: {
        teams: teams.map((team) => {
          const counts = teamCounts.get(team.id);
          return { ...team, name: team.name ? team.name : team.id,
            color: team.color ? team.color : '#999',
            counts: visibleTypes.map((type) => {
              const count = counts.get(type);
              return count === undefined ? 0 : count;
            }),
          };
        }),
        allSelected: teams.every((team) => team.selected),
        taskTypes: visibleTypes.map((key) => sel.feature.getTypeDisplayName(key)),
        countsOpen: this.host.teamCountsOpen,
        hasMoreCounts: nonemptyTypes.length > 2,
        taskViewMode: sel.view.getTaskViewMode(),
      },
      hierarchy: { active: this.host.foldActive, foldedCount: this.host.foldedCount,
        foldableCount: this.host.foldableCount, canCollapse: this.host.canCollapse },
      filters: {
        dimensions: SIDEBAR_FILTER_DIMENSIONS.map((dimension) => ({ ...dimension,
          options: dimension.options.map((option) => ({ ...option,
            active: filters[dimension.key][option.key],
            disabled: sel.filter.isSidebarControlDisabled('taskFilter', dimension.key, option.key),
          })),
        })),
        states: sel.filter.getAvailableFeatureStates().filter((name) => scopedStates.has(name)).map((name) => ({
          name, color: colors[name].background, active: selectedStates.has(name),
          disabled: sel.filter.isSidebarControlDisabled('state', name),
        })),
        types: sel.feature.getTaskTypeOptions().filter((type) => scopedTypes.has(type.key))
          .map((type) => ({ ...type, active: sel.view.isTypeVisible(type.key),
            disabled: sel.filter.isSidebarControlDisabled('taskType', type.key) })),
      },
    };
  }
}