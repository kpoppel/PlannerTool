// Test file for eventBus.js
// Run with scripts/run_js_tests.mjs

import * as eventBus from '../../www/js/eventBus.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        console.error(`FAIL: ${message} (expected: ${expected}, got: ${actual})`);
    } else {
        console.log(`PASS: ${message}`);
    }
}

console.log('Running eventBus.js tests...');

// Add eventBus function tests below
