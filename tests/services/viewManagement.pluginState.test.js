import { expect } from '@esm-bundle/chai';
import { ViewManagementService } from '../../www/js/services/ViewManagementService.js';
import { dataService } from '../../www/js/services/dataService.js';

describe('ViewManagementService pluginState integration', () => {
  let mockBus;
  let mockViewService;
  let mockState;
  let viewService;
  let originalSaveView;
  let originalGetView;

  beforeEach(() => {
    mockBus = { emit: () => {}, on: () => {}, off: () => {} };
    mockViewService = { captureCurrentView: () => ({ foo: 'bar' }), restoreView: () => {} };

    // Minimal state with pluginStateService stub
    mockState = {
      projects: [],
      teams: [],
      availableFeatureStates: [],
      taskFilterService: null,
      _stateFilterService: null,
      setProjectsSelectedBulk: () => {},
      setTeamsSelectedBulk: () => {},
      setExpansionState: () => {},
    };

    // Mock document.querySelector for sidebar
    global.document = { querySelector: (s) => null };

    viewService = new ViewManagementService(mockBus, mockState, mockViewService);

    // Stub dataService.saveView to capture payload
    originalSaveView = dataService.saveView;
    originalGetView = dataService.getView;
  });

  afterEach(() => {
    dataService.saveView = originalSaveView;
    dataService.getView = originalGetView;
  });

  it('saveCurrentView includes pluginState when captureForView returns data', async () => {
    const pluginMap = { 'plugin-cost-v2': { startDate: '2026-01-01' } };
    mockState.pluginStateService = { captureForView: () => pluginMap };

    let savedArg = null;
    dataService.saveView = async (view) => {
      savedArg = view;
      // Simulate server assigning an id
      return Object.assign({}, view, { id: 'sv1' });
    };

    const res = await viewService.saveCurrentView('MyView');
    expect(savedArg).to.not.equal(null);
    expect(savedArg.viewOptions).to.exist;
    expect(savedArg.viewOptions.pluginState).to.deep.equal(pluginMap);
    expect(res.id).to.equal('sv1');
  });

  it('loadAndApplyView restores pluginState via restoreFromView', async () => {
    const pluginMap = { 'plugin-cost-v2': { startDate: '2026-02-02' } };
    let restoreCalled = false;
    mockState.pluginStateService = { restoreFromView: async (pm) => { restoreCalled = true; expect(pm).to.deep.equal(pluginMap); } };

    dataService.getView = async () => ({
      id: 'v1',
      name: 'v1',
      selectedProjects: {},
      selectedTeams: {},
      viewOptions: { pluginState: pluginMap },
    });

    await viewService.loadAndApplyView('v1');
    expect(restoreCalled).to.equal(true);
  });

  it('loadAndApplyView clears persisted pluginState when the view has none', async () => {
    let restoreCalled = false;
    mockState.pluginStateService = {
      restoreFromView: async (pm) => {
        restoreCalled = true;
        expect(pm).to.deep.equal({});
      },
    };

    dataService.getView = async () => ({
      id: 'v2',
      name: 'v2',
      selectedProjects: {},
      selectedTeams: {},
      viewOptions: {},
    });

    await viewService.loadAndApplyView('v2');
    expect(restoreCalled).to.equal(true);
  });
});
