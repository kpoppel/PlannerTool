/**
 * Unit tests for the no-runtime-state-violations ESLint rule.
 * Uses ESLint's RuleTester API.
 *
 * Run via: npx vitest tests/eslint-rules/no-runtime-state-violations.test.js
 */

import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-runtime-state-violations.js';

const tester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

// RuleTester.run() calls describe()/it() internally — call it at the top level.

tester.run('bus.emit — benign payloads pass', rule, {
  valid: [
    { code: `bus.emit(MyEvent.FOO, { ids: [1, 2, 3] });` },
    { code: `eventBus.emit(MyEvent.FOO, { ids: [1, 2, 3] });` },
    { code: `bus.emit(MyEvent.FOO, { offset: 0 });` },
    { code: `bus.emit(MyEvent.FOO, payload);` },
    { code: `socket.emit(MyEvent.FOO, { scenario: x });` },
    { code: `bus.emit(MyEvent.READY);` },
  ],
  invalid: [],
});

tester.run('bus.emit — state-shape payload keys warn', rule, {
  valid: [],
  invalid: [
    {
      code: `bus.emit(FeatureEvents.UPDATED, { features: allFeatures });`,
      errors: [{ messageId: 'busEmitStatePayload' }],
    },
    {
      code: `bus.emit(ScenarioEvents.CHANGED, { scenarios: list, ids: [] });`,
      errors: [{ messageId: 'busEmitStatePayload' }],
    },
    {
      code: `bus.emit(CapacityEvents.UPDATED, { capacity: data });`,
      errors: [{ messageId: 'busEmitStatePayload' }],
    },
    {
      code: `this.bus.emit(CapacityEvents.UPDATED, { teamDailyCapacity: data });`,
      errors: [{ messageId: 'busEmitStatePayload' }],
    },
    {
      code: `const payload = { scenarios: list, ids: [] }; eventBus.emit(X.Y, payload);`,
      errors: [{ messageId: 'busEmitStatePayload' }],
    },
    {
      code: `bus.emit(X.Y, { scenario: s });`,
      errors: [{ messageId: 'busEmitStatePayload' }],
    },
  ],
});

tester.run('test file — private field access warns', rule, {
  valid: [
    {
      filename: 'tests/services/state.test.js',
      code: `window._TEST_SETUP = true;`,
    },
    {
      filename: 'tests/services/state.test.js',
      code: `customElements._safeDefine?.('x-el', Klass);`,
    },
  ],
  invalid: [
    {
      filename: 'tests/services/state.test.js',
      code: `import { state } from '../../www/js/services/State.js'; state._scenarioEventService.init();`,
      errors: [{ messageId: 'testPrivateAccess' }],
    },
    {
      filename: 'tests/services/state.test.js',
      code: `import { state } from '../../www/js/services/State.js'; state._stateFilterService._selectedStates = new Set(['New']);`,
      errors: [
        { messageId: 'testPrivateAccess' },
        { messageId: 'testPrivateAccess' },
      ],
    },
  ],
});

tester.run('test file — public method access does not warn', rule, {
  valid: [
    {
      filename: 'tests/services/state.test.js',
      code: `state.getEffectiveFeatures();`,
    },
  ],
  invalid: [],
});

tester.run('store.setState — warns outside commands, silent inside', rule, {
  valid: [
    {
      // Inside application/commands/** — no warning
      filename: 'www/js/application/commands/updateCapacity.js',
      code: `store.setState({ capacity: newCapacity });`,
    },
  ],
  invalid: [
    {
      filename: 'www/js/services/State.js',
      code: `store.setState({ features: [] });`,
      errors: [{ messageId: 'storeSetStateOutsideCommands' }],
    },
  ],
});

