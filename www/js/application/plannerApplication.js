import { bus } from '../core/EventBus.js';
import { createPlannerApplication } from './createPlannerApplication.js';
import { createPlannerApi } from './PlannerApi.js';
import { createPlannerSelectors } from './selectors/createPlannerSelectors.js';
import { createPlannerCommands } from './commands/createPlannerCommands.js';
import { createPlannerRuntimeServices } from './createPlannerRuntimeServices.js';

/**
 * Browser application composition root.
 *
 * Runtime collaborators are explicitly composed here. Consumers obtain the
 * versioned `applicationApi`; they do not import service implementations.
 */
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
  createServices: ({ eventBus, adapters, store }) => {
    const runtimeServices = createPlannerRuntimeServices({
      eventBus,
      adapters,
      store,
    });
    return {
      ...runtimeServices,
      initialize: () => runtimeServices.runtime.initialize(),
      destroy: () => runtimeServices.runtime.destroy(),
    };
  },
  createSelectors: ({ store }) => createPlannerSelectors({ store }),
  createCommands: ({ store, services, selectors }) =>
    createPlannerCommands({ store, services, selectors }),
});

export const applicationApi = createPlannerApi({
  runtime: plannerApplication.services.runtime,
  commands: plannerApplication.commands,
  selectors: plannerApplication.selectors,
});

