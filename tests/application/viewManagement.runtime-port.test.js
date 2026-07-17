import { expect } from '@esm-bundle/chai';

import { AppStore } from '../../www/js/application/AppStore.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createPlannerRuntimeServices } from '../../www/js/application/createPlannerRuntimeServices.js';
import { FilterEvents } from '../../www/js/core/EventRegistry.js';
import { dataService } from '../../www/js/services/dataService.js';

describe('view management runtime port integration', () => {
  let originalListViews;

  beforeEach(() => {
    originalListViews = dataService.listViews;
  });

  afterEach(() => {
    dataService.listViews = originalListViews;
  });

  it('restores default view when last-view id is stale and persists canonical view state', async () => {
    dataService.listViews = async () => [];

    const store = new AppStore(createInitialAppState());
    const bus = {
      emit: () => {},
      on: () => () => {},
    };

    const runtimeServices = createPlannerRuntimeServices({
      eventBus: bus,
      store,
      adapters: {
        viewManagement: {
          storage: {
            getItem: () => 'missing-view-id',
            setItem: () => {},
          },
        },
      },
      dataService: {
        getLocalPref: async () => null,
      },
    });

    const { runtime } = runtimeServices;

    await runtime.viewManagementService.loadViews();
    await runtime.viewManagementService.restoreLastView();

    const state = store.getState();
    const savedViewIds = state.view.saved.map((view) => view.id);

    expect(savedViewIds).to.include('default');
    expect(state.view.activeId).to.equal('default');

    await runtime.destroy();
  });

  it('does not duplicate saved views across repeated reloads', async () => {
    dataService.listViews = async () => [
      {
        id: 'view-team-1',
        name: 'Team View 1',
        readonly: false,
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: {},
      },
    ];

    const store = new AppStore(createInitialAppState());
    const bus = {
      emit: () => {},
      on: () => () => {},
    };

    const runtimeServices = createPlannerRuntimeServices({
      eventBus: bus,
      store,
      adapters: {
        viewManagement: {
          storage: {
            getItem: () => null,
            setItem: () => {},
          },
        },
      },
      dataService: {
        getLocalPref: async () => null,
      },
    });

    const { runtime } = runtimeServices;

    await runtime.viewManagementService.loadViews();
    await runtime.viewManagementService.loadViews();

    const state = store.getState();
    const savedViewIds = state.view.saved.map((view) => view.id);

    expect(savedViewIds).to.deep.equal(['default', 'view-team-1']);
    expect(state.view.saved).to.have.length(2);

    await runtime.destroy();
  });

  it('emits restored task filters and selected states during view restore transaction', async () => {
    const emitted = [];
    const store = new AppStore(createInitialAppState());
    const bus = {
      emit: (event, payload) => {
        emitted.push({ event, payload });
      },
      on: () => () => {},
    };

    const runtimeServices = createPlannerRuntimeServices({
      eventBus: bus,
      store,
      adapters: {
        viewManagement: {
          storage: {
            getItem: () => null,
            setItem: () => {},
          },
        },
      },
      dataService: {
        getLocalPref: async () => null,
      },
    });

    const { runtime } = runtimeServices;

    runtime.applyViewRestoreTransaction({
      selectedStates: ['In Progress'],
      taskFilters: {
        schedule: { planned: true, unplanned: false },
      },
    });

    const selectedStatesEvent = emitted.find(
      (entry) =>
        entry.event === FilterEvents.CHANGED &&
        Array.isArray(entry.payload?.selectedFeatureStateFilter)
    );
    const taskFiltersEvent = emitted.find(
      (entry) => entry.event === FilterEvents.CHANGED && entry.payload?.taskFilters
    );

    expect(selectedStatesEvent).to.exist;
    expect(selectedStatesEvent.payload.selectedFeatureStateFilter).to.deep.equal([
      'In Progress',
    ]);
    expect(taskFiltersEvent).to.exist;
    expect(taskFiltersEvent.payload.taskFilters.schedule.unplanned).to.equal(false);

    await runtime.destroy();
  });
});
