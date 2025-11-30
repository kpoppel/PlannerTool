// Test file for colorManager.js
// Run with scripts/run_js_tests.mjs

import * as colorManager from '../../www/js/colorManager.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        console.error(`FAIL: ${message} (expected: ${expected}, got: ${actual})`);
    } else {
        console.log(`PASS: ${message}`);
    }
}

console.log('Running colorManager.js tests...');

// Add colorManager function tests below
