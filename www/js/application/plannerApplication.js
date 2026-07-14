import { bus } from '../core/EventBus.js';
import { state } from '../services/State.js';
import { createPlannerApplication } from './createPlannerApplication.js';
import { createPlannerApi } from './PlannerApi.js';

/**
 * Browser application composition root.
 *
 * `State` is the current implementation of the composed runtime service. It
 * is intentionally imported only here; runtime consumers obtain either the
 * versioned `applicationApi` or the composed `applicationRuntime` service.
 */
export const applicationApi = createPlannerApi(state);

export const plannerApplication = createPlannerApplication({
  eventBus: bus,
  adapters: {
    viewLayout: {
      getTimelineSectionWidth: () => {
        const board = document.querySelector('timeline-board');
        if (!board) return null;
        const root = board.renderRoot || board.shadowRoot || board;
        return root?.querySelector?.('#timelineSection')?.clientWidth || null;
      },
    },
    viewManagement: {
      storage: {
        getItem: (key) => localStorage.getItem(key),
        setItem: (key, value) => localStorage.setItem(key, value),
      },
      ui: {
        getSidebarElement: () => document.querySelector('app-sidebar'),
      },
    },
  },
  createServices: ({ adapters }) => ({
    runtime: state,
    initialize: () => {
      state.setEnvironmentAdapters({
        viewLayout: adapters.viewLayout,
        viewManagement: adapters.viewManagement,
      });
      return state.init();
    },
  }),
});

/**
 * The runtime service composed for browser UI modules. New integrations should
 * prefer the narrow, versioned `applicationApi` surface.
 */
export const applicationRuntime = plannerApplication.services.runtime;
