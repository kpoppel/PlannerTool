// Test file for util.js
// Run with scripts/run_js_tests.mjs

import * as util from '../../www/js/util.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        console.error(`FAIL: ${message} (expected: ${expected}, got: ${actual})`);
    } else {
        console.log(`PASS: ${message}`);
    }
}

// Example test cases for util.js
console.log('Running util.js tests...');

// parseDate
const date = util.parseDate('2025-11-30');
assertEqual(date.getFullYear(), 2025, 'parseDate year');
assertEqual(date.getMonth(), 10, 'parseDate month (0-based)');
assertEqual(date.getDate(), 30, 'parseDate day');

// formatDate
const formatted = util.formatDate(new Date(2025, 10, 30));
assertEqual(formatted, '2025-11-30', 'formatDate output');

// addMonths
const plus2Months = util.addMonths(new Date(2025, 10, 30), 2);
assertEqual(util.formatDate(plus2Months), '2026-01-30', 'addMonths output');

// addDays
const plus5Days = util.addDays(new Date(2025, 10, 30), 5);
assertEqual(util.formatDate(plus5Days), '2025-12-05', 'addDays output');

// dateRangeInclusiveMonths
const range = util.dateRangeInclusiveMonths('2025-10-01', '2025-11-01');
assertEqual(range.length, 1, 'dateRangeInclusiveMonths length');
if (range[0]) {
    assertEqual(util.formatDate(range[0]), '2025-10-01', 'dateRangeInclusiveMonths first');
} else {
    console.error('FAIL: dateRangeInclusiveMonths first (range[0] is undefined)');
}
