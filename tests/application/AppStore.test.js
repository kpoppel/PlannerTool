import { expect } from '@esm-bundle/chai';

import { AppStore } from '../../www/js/application/AppStore.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createPlannerApplication } from '../../www/js/application/createPlannerApplication.js';

describe('AppStore', () => {
  it('commits immutable state and increments its revision once per real change', () => {
    const store = new AppStore(createInitialAppState());
    const initial = store.getState();

    const changed = store.update('selection.project', (draft) => {
      draft.selection.projectIds.push('project-1');
    });

    expect(changed).to.equal(true);
    expect(store.revision).to.equal(1);
    expect(store.getState().selection.projectIds).to.deep.equal(['project-1']);
    expect(initial.selection.projectIds).to.deep.equal([]);
    expect(Object.isFrozen(store.getState())).to.equal(true);
    expect(Object.isFrozen(store.getState().selection.projectIds)).to.equal(true);

    const noChange = store.update('selection.unchanged', () => {});
    expect(noChange).to.equal(false);
    expect(store.revision).to.equal(1);
  });

  it('notifies only subscribers whose selected value changed', () => {
    const store = new AppStore(createInitialAppState());
    const notifications = [];
    const unsubscribe = store.subscribe(
      (state) => state.selection.projectIds,
      (value, previous, change) => notifications.push({ value, previous, label: change.label }),
      { equals: (left, right) => left.join('|') === right.join('|') }
    );

    store.update('view.option', (draft) => {
      draft.view.options.displayMode = 'compact';
    });
    store.update('selection.project', (draft) => {
      draft.selection.projectIds = ['project-1'];
    });
    unsubscribe();
    store.update('selection.project.second', (draft) => {
      draft.selection.projectIds = ['project-1', 'project-2'];
    });

    expect(notifications).to.deep.equal([
      {
        value: ['project-1'],
        previous: [],
        label: 'selection.project',
      },
    ]);
  });

  it('rejects nested updates and invalid root state', () => {
    const store = new AppStore(createInitialAppState());

    expect(() => new AppStore([])).to.throw('AppStore state must be a plain object');
    expect(() => store.update('', () => {})).to.throw('non-empty label');
    expect(() => store.update('invalid', () => [])).to.throw(
      'AppStore state must be a plain object'
    );
    expect(() =>
      store.update('outer', () => {
        store.update('inner', () => {});
      })
    ).to.throw('Nested AppStore update is not allowed');
  });
});

describe('createPlannerApplication', () => {
  it('composes explicit dependencies and runs lifecycle hooks in order', async () => {
    const calls = [];
    const application = createPlannerApplication({
      adapters: { storage: { getItem: () => null } },
      gateways: { baseline: { load: async () => ({}) } },
      createServices: ({ adapters, gateways, store }) => {
        expect(adapters.storage).to.exist;
        expect(gateways.baseline).to.exist;
        expect(store).to.exist;
        return {
          async initialize() {
            calls.push('services.initialize');
          },
          async destroy() {
            calls.push('services.destroy');
          },
        };
      },
      createSelectors: ({ services }) => ({
        lifecycle: () => services,
      }),
      createCommands: ({ selectors }) => ({
        async initialize() {
          calls.push('commands.initialize');
          expect(selectors.lifecycle()).to.exist;
        },
        async destroy() {
          calls.push('commands.destroy');
        },
      }),
    });

    await application.initialize();
    expect(application.initialized).to.equal(true);
    expect(application.getState().lifecycle.status).to.equal('ready');
    expect(calls).to.deep.equal(['services.initialize', 'commands.initialize']);

    await application.destroy();
    expect(calls).to.deep.equal([
      'services.initialize',
      'commands.initialize',
      'commands.destroy',
      'services.destroy',
    ]);
  });

  it('records lifecycle initialization failures and allows a retry', async () => {
    let attempts = 0;
    const application = createPlannerApplication({
      createServices: () => ({
        async initialize() {
          attempts += 1;
          if (attempts === 1) throw new Error('network unavailable');
        },
      }),
    });

    let failure = null;
    try {
      await application.initialize();
    } catch (error) {
      failure = error;
    }
    expect(failure?.message).to.equal('network unavailable');
    expect(application.getState().lifecycle).to.deep.equal({
      status: 'failed',
      error: 'network unavailable',
    });

    await application.initialize();
    expect(application.initialized).to.equal(true);
    expect(attempts).to.equal(2);
  });
});
