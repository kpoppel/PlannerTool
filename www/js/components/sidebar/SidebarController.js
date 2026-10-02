import { sel } from '../../application/imports.js';
import { isStoreReady } from '../../application/store.js';
import { StoreController } from '../../core/StoreController.js';
import { bus } from '../../core/EventBus.js';
import { BoardEvents, FeatureEvents } from '../../core/EventRegistry.js';
import { dataService } from '../../services/dataService.js';
import { SIDEBAR_FILTER_DIMENSIONS } from './SidebarTaskFilters.lit.js';

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
    this._healthRequest = 0;
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
    this.refreshServerStatus();
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
    this._healthRequest += 1;
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
      if (isStoreReady()) this.host.resolvedTasksCount = sel.scope.getResolvedFeatures().length;
      this.host.requestUpdate();
    });
  }

  async refreshServerStatus() {
    const request = ++this._healthRequest;
    const connection = this.connection;
    const isCurrent = () => this._connected && request === this._healthRequest &&
      connection === this.connection;
    try {
      const result = await dataService.checkHealth();
      if (!isCurrent()) return;
      if (!result.ok) {
        console.error('[Sidebar] Health check failed', result.error);
        this.host.serverStatus = 'Server: error';
      } else {
        const health = result.data;
        const totalMinutes = Math.floor(health.uptime_seconds / 60);
        this.host.serverName = health.server_name;
        this.host.serverStatus = `${health.version} | Server: ${health.status} - Uptime: ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error('[Sidebar] Failed to refresh server status', error);
      this.host.serverStatus = 'Server: error';
    }
    this.host.requestUpdate();
  }

  getPresentationModel(teams) {
    const taskTypes = sel.feature.getAvailableTaskTypesOrdered();
    const filters = sel.filter.getTaskFilters();
    const colors = sel.filter.getFeatureStateColors();
    const selectedStates = sel.filter.getSelectedFeatureStateSet();
    return {
      teams: {
        teams: teams.map((team) => {
          const counts = sel.feature.getCountsForTeam(team.id);
          return { ...team, name: team.name ? team.name : team.id,
            color: team.color ? team.color : '#999',
            counts: taskTypes.map((type) => {
              const count = counts.get(type.toLowerCase());
              return count === undefined ? 0 : count;
            }),
          };
        }),
        allSelected: teams.every((team) => team.selected), taskTypes,
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
        states: sel.filter.getAvailableFeatureStates().map((name) => ({
          name, color: colors[name].background, active: selectedStates.has(name),
          disabled: sel.filter.isSidebarControlDisabled('state', name),
        })),
        types: taskTypes.map((name) => ({ name, active: sel.view.isTypeVisible(name),
          disabled: sel.filter.isSidebarControlDisabled('taskType', name) })),
      },
      footer: { serverName: this.host.serverName, serverStatus: this.host.serverStatus,
        resolvedTasksCount: this.host.resolvedTasksCount },
    };
  }
}