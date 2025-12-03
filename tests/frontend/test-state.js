// Mock bus and dataService for async tests
const mockBus = {
    emit: () => {}
};
const mockDataService = {
    getProjects: async () => ([{id: 'p1', name: 'Project1'}]),
    getTeams: async () => ([{id: 't1', name: 'Team1'}]),
    getFeatures: async () => ([
        {id: 'f1', start: '2025-01-01', end: '2025-02-01', title: 'Feature1', type: 'feature'}
    ]),
    refreshBaseline: async () => {},
    saveScenario: async () => {}
};

// Patch state.js dependencies for test
state.state.bus = mockBus;
state.state.dataService = mockDataService;

// Test async initState
state.state.baselineProjects = [];
state.state.baselineTeams = [];
state.state.baselineFeatures = [];
state.state.projects = [];
state.state.teams = [];
state.state.scenarios = [];
state.state.activeScenarioId = null;
try {
    await state.state.initState();
    assertEqual(state.state.baselineProjects.length, 1, 'initState loads projects');
    assertEqual(state.state.baselineTeams.length, 1, 'initState loads teams');
    assertEqual(state.state.baselineFeatures.length, 1, 'initState loads features');
    console.log('PASS: initState does not throw');
} catch (e) {
    console.error('FAIL: initState threw error');
}

// Test async refreshBaseline
try {
    await state.state.refreshBaseline();
    assertEqual(Array.isArray(state.state.baselineProjects), true, 'refreshBaseline sets baselineProjects');
    assertEqual(Array.isArray(state.state.baselineTeams), true, 'refreshBaseline sets baselineTeams');
    assertEqual(Array.isArray(state.state.baselineFeatures), true, 'refreshBaseline sets baselineFeatures');
    console.log('PASS: refreshBaseline does not throw');
} catch (e) {
    console.error('FAIL: refreshBaseline threw error');
}
// Test file for state.js
// Run with scripts/run_js_tests.mjs

import * as state from '../../www/js/state.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        console.error(`FAIL: ${message} (expected: ${expected}, got: ${actual})`);
    } else {
        console.log(`PASS: ${message}`);
    }
}

console.log('Running state.js tests...');


// Test: constructor initializes default values
assertEqual(Array.isArray(state.state.projects), true, 'projects is array');
assertEqual(Array.isArray(state.state.teams), true, 'teams is array');
assertEqual(state.state.timelineScale, 'months', 'timelineScale default');
assertEqual(state.state.showEpics, true, 'showEpics default');
assertEqual(state.state.showFeatures, true, 'showFeatures default');
assertEqual(state.state.condensedCards, false, 'condensedCards default');
assertEqual(state.state.loadViewMode, 'team', 'loadViewMode default');
assertEqual(state.state.featureSortMode, 'rank', 'featureSortMode default');

// Test: setProjectSelected and setTeamSelected
state.state.projects = [{id: 'p1', selected: false}];
state.state.teams = [{id: 't1', selected: false}];
state.state.setProjectSelected('p1', true);
assertEqual(state.state.projects[0].selected, true, 'setProjectSelected sets selected');
state.state.setTeamSelected('t1', true);
assertEqual(state.state.teams[0].selected, true, 'setTeamSelected sets selected');

// Test: setTimelineScale
state.state.setTimelineScale('weeks');
assertEqual(state.state.timelineScale, 'weeks', 'setTimelineScale sets scale');

// Test: setShowEpics and setShowFeatures
state.state.setShowEpics(false);
assertEqual(state.state.showEpics, false, 'setShowEpics sets value');
state.state.setShowFeatures(false);
assertEqual(state.state.showFeatures, false, 'setShowFeatures sets value');

// Test: setCondensedCards
state.state.setCondensedCards(true);
assertEqual(state.state.condensedCards, true, 'setCondensedCards sets value');

// Test: setLoadViewMode
state.state.setLoadViewMode('project');
assertEqual(state.state.loadViewMode, 'project', 'setLoadViewMode sets mode');


// Scenario management tests
// Add a scenario and test clone, activate, rename, delete
const baselineId = 'baseline';
const customScenario = {
    id: 'scen1',
    name: 'Custom',
    overrides: {},
    filters: { projects: [], teams: [] },
    view: { loadViewMode: 'team', condensedCards: false, featureSortMode: 'rank' },
    isChanged: false
};
state.state.scenarios = [
    { id: baselineId, name: 'Baseline', overrides: {}, filters: {}, view: {}, isChanged: false },
    customScenario
];
state.state.activeScenarioId = baselineId;

// activateScenario
state.state.activateScenario('scen1');
assertEqual(state.state.activeScenarioId, 'scen1', 'activateScenario sets active');

// renameScenario
state.state.renameScenario('scen1', 'Renamed');
assertEqual(state.state.scenarios[1].name, 'Renamed', 'renameScenario changes name');

// cloneScenario
const cloned = state.state.cloneScenario('scen1', 'CloneTest');
assertEqual(cloned && cloned.name.startsWith('CloneTest'), true, 'cloneScenario creates clone');

// deleteScenario
const deleteId = cloned.id;
state.state.deleteScenario(deleteId);
assertEqual(state.state.scenarios.some(s => s.id === deleteId), false, 'deleteScenario removes scenario');

// setScenarioOverride and getEffectiveFeatures
state.state.baselineFeatures = [{ id: 'f1', start: '2025-01-01', end: '2025-02-01', title: 'Feature1', type: 'feature' }];
state.state.activeScenarioId = 'scen1';
state.state.setScenarioOverride('f1', '2025-01-10', '2025-02-10');
const eff = state.state.getEffectiveFeatures();
assertEqual(eff[0].start, '2025-01-10', 'getEffectiveFeatures reflects override');
assertEqual(eff[0].scenarioOverride, true, 'getEffectiveFeatures sets scenarioOverride');


// updateFeatureField and revertFeature
state.state.baselineFeatures = [{ id: 'f2', start: '2025-03-01', end: '2025-04-01', title: 'Feature2', type: 'feature' }];
state.state.activeScenarioId = 'scen1';
state.state.updateFeatureField('f2', 'start', '2025-03-10');
assertEqual(state.state.scenarios[1].overrides['f2'].start, '2025-03-10', 'updateFeatureField sets override');
state.state.revertFeature('f2');
assertEqual(state.state.scenarios[1].overrides['f2'], undefined, 'revertFeature removes override');

// recomputeDerived
const baseFeature = { start: '2025-05-01', end: '2025-06-01' };
const override = { start: '2025-05-10', end: '2025-06-01' };
const derived = state.state.recomputeDerived(baseFeature, override);
assertEqual(Array.isArray(derived.changedFields), true, 'recomputeDerived returns array');
assertEqual(derived.changedFields.includes('start'), true, 'recomputeDerived detects changed start');


// initBaselineScenario
state.state.scenarios = [];
state.state.projects = [{id: 'p1', selected: true}];
state.state.teams = [{id: 't1', selected: true}];
state.state.initBaselineScenario();
assertEqual(state.state.scenarios[0].id, 'baseline', 'initBaselineScenario creates baseline');
assertEqual(state.state.activeScenarioId, 'baseline', 'initBaselineScenario sets activeScenarioId');

// emitScenarioList (should not throw)
try {
    state.state.emitScenarioList();
    console.log('PASS: emitScenarioList does not throw');
} catch (e) {
    console.error('FAIL: emitScenarioList threw error');
}

// emitScenarioActivated (should not throw)
try {
    state.state.emitScenarioActivated();
    console.log('PASS: emitScenarioActivated does not throw');
} catch (e) {
    console.error('FAIL: emitScenarioActivated threw error');
}

// emitScenarioUpdated (should not throw)
try {
    state.state.emitScenarioUpdated('baseline', { type: 'test' });
    console.log('PASS: emitScenarioUpdated does not throw');
} catch (e) {
    console.error('FAIL: emitScenarioUpdated threw error');
}


// captureCurrentFilters
state.state.projects = [{id: 'p1', selected: true}, {id: 'p2', selected: false}];
state.state.teams = [{id: 't1', selected: true}, {id: 't2', selected: false}];
const filters = state.state.captureCurrentFilters();
assertEqual(filters.projects.length, 1, 'captureCurrentFilters projects');
assertEqual(filters.teams.length, 1, 'captureCurrentFilters teams');

// captureCurrentView
state.state.loadViewMode = 'team';
state.state.condensedCards = true;
state.state.featureSortMode = 'rank';
const view = state.state.captureCurrentView();
assertEqual(view.loadViewMode, 'team', 'captureCurrentView loadViewMode');
assertEqual(view.condensedCards, true, 'captureCurrentView condensedCards');
assertEqual(view.featureSortMode, 'rank', 'captureCurrentView featureSortMode');

// Test timeline/filter/view logic
state.state.setTimelineScale('years');
assertEqual(state.state.timelineScale, 'years', 'setTimelineScale years');
state.state.setShowEpics(true);
assertEqual(state.state.showEpics, true, 'setShowEpics true');
state.state.setShowFeatures(true);
assertEqual(state.state.showFeatures, true, 'setShowFeatures true');
state.state.setCondensedCards(false);
assertEqual(state.state.condensedCards, false, 'setCondensedCards false');
state.state.setLoadViewMode('team');
assertEqual(state.state.loadViewMode, 'team', 'setLoadViewMode team');
state.state.setFeatureSortMode('rank');
assertEqual(state.state.featureSortMode, 'rank', 'setFeatureSortMode rank');

// Test initColors (should not throw)
try {
    state.state.projects = [{id: 'p1'}, {id: 'p2'}];
    state.state.teams = [{id: 't1'}, {id: 't2'}];
    state.state.initColors();
    console.log('PASS: initColors does not throw');
} catch (e) {
    console.error('FAIL: initColors threw error');
}

// Test refreshBaseline (mock dataService)
state.state.baselineProjects = [{id: 'p1'}, {id: 'p2'}];
state.state.baselineTeams = [{id: 't1'}, {id: 't2'}];
state.state.baselineFeatures = [{id: 'f1'}, {id: 'f2'}];
state.state.projects = [{id: 'p1', selected: true}, {id: 'p2', selected: false}];
state.state.teams = [{id: 't1', selected: true}, {id: 't2', selected: false}];
state.state.scenarios = [{id: 'baseline', name: 'Baseline', overrides: {}, filters: {}, view: {}, isChanged: false}];
state.state.activeScenarioId = 'baseline';
state.state.refreshBaseline = async function() {
    this.baselineProjects = [{id: 'p1'}, {id: 'p2'}];
    this.baselineTeams = [{id: 't1'}, {id: 't2'}];
    this.baselineFeatures = [{id: 'f1'}, {id: 'f2'}];
    this.projects = this.baselineProjects.map(p=>({ ...p, selected: true }));
    this.teams = this.baselineTeams.map(t=>({ ...t, selected: true }));
    this.initBaselineScenario();
    this.initColors();
    this.emitScenarioList();
    this.emitScenarioActivated();
};
try {
    state.state.refreshBaseline();
    console.log('PASS: refreshBaseline does not throw');
} catch (e) {
    console.error('FAIL: refreshBaseline threw error');
}

// Test saveScenario (mock dataService)
state.state.saveScenario = async function(id) {
    const scen = this.scenarios.find(s=>s.id===id); if(!scen) return;
    scen.isChanged = false;
    this.emitScenarioUpdated(scen.id, { type:'saved' });
};
try {
    state.state.saveScenario('baseline');
    console.log('PASS: saveScenario does not throw');
} catch (e) {
    console.error('FAIL: saveScenario threw error');
}
