// Test file for dataService.js
// Run with scripts/run_js_tests.mjs

import * as dataService from '../../www/js/dataService.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        console.error(`FAIL: ${message} (expected: ${expected}, got: ${actual})`);
    } else {
        console.log(`PASS: ${message}`);
    }
}

console.log('Running dataService.js tests...');


// Test all public async functions
(async () => {
    try {
        const config = await dataService.dataService.getConfig();
        assertEqual(typeof config, 'object', 'getConfig returns object');

        const capabilities = await dataService.dataService.getCapabilities();
        assertEqual(typeof capabilities, 'object', 'getCapabilities returns object');

        const health = await dataService.dataService.checkHealth();
        assertEqual(typeof health, 'object', 'checkHealth returns object');

        const patResult = await dataService.dataService.setPat('test-pat');
        assertEqual(typeof patResult, 'object', 'setPat returns object');

        const all = await dataService.dataService.getAll();
        assertEqual(Array.isArray(all.projects), true, 'getAll returns projects array');

        const projects = await dataService.dataService.getProjects();
        assertEqual(Array.isArray(projects), true, 'getProjects returns array');

        const teams = await dataService.dataService.getTeams();
        assertEqual(Array.isArray(teams), true, 'getTeams returns array');

        const features = await dataService.dataService.getFeatures();
        assertEqual(Array.isArray(features), true, 'getFeatures returns array');

        const setDates = await dataService.dataService.setFeatureDates('epic-alpha-1', '2025-01-01', '2025-06-30');
        assertEqual(typeof setDates, 'object', 'setFeatureDates returns object');

        const setField = await dataService.dataService.setFeatureField('epic-alpha-1', 'start', '2025-01-01');
        assertEqual(typeof setField, 'object', 'setFeatureField returns object');

        const batchSet = await dataService.dataService.batchSetFeatureDates([{id:'epic-alpha-1',start:'2025-01-01',end:'2025-06-30'}]);
        assertEqual(Array.isArray(batchSet), true, 'batchSetFeatureDates returns array');

        const scenarios = await dataService.dataService.listScenarios();
        assertEqual(Array.isArray(scenarios), true, 'listScenarios returns array');

        const deleteScen = await dataService.dataService.deleteScenario('live');
        assertEqual(typeof deleteScen, 'boolean', 'deleteScenario returns boolean');

        const renameScen = await dataService.dataService.renameScenario('live', 'Renamed');
        assertEqual(typeof renameScen, 'object', 'renameScenario returns object');

        const publishBaseline = await dataService.dataService.publishBaseline([]);
        assertEqual(typeof publishBaseline, 'object', 'publishBaseline returns object');

        const refreshBaseline = await dataService.dataService.refreshBaseline();
        assertEqual(typeof refreshBaseline, 'object', 'refreshBaseline returns object');

        const saveScenario = await dataService.dataService.saveScenario({id:'live',name:'Live',overrides:{},filters:{},view:{}});
        assertEqual(typeof saveScenario, 'object', 'saveScenario returns object');

        console.log('PASS: All dataService.js functions tested');
    } catch (e) {
        console.error('FAIL: dataService.js function threw error', e);
    }
})();
