// tests/components/utc-date-handling.test.js
// TDD test for UTC date handling bug - dragging to April 1st renders at March 1st
//
// Bug: The codebase uses local time for date calculations, causing off-by-one
// errors near DST transitions (e.g., April 1st becomes March 31st or vice versa)
// when the timezone offset changes at midnight.
//
// Root cause: When calculating month boundaries using milliseconds, the code
// assumes 24 hours per day. But DST transitions cause some days to have 23 or 25
// hours, throwing off month index calculations.
//
// Example: In Europe/Copenhagen, March 30, 2025 has only 23 hours due to
// spring-forward DST. This means March 1 to April 1 spans ~30.96 "standard days"
// worth of milliseconds instead of 31 days.
//
// Fix: Use the actual next month's start time (which correctly handles DST)
// instead of calculating with days * msPerDay.

import { expect } from '@open-wc/testing';
import { parseDate, formatDate, addMonths, dateRangeInclusiveMonths, addDays } from '../../www/js/components/util.js';
import { computePosition, _test_resetCache } from '../../www/js/components/board-utils.js';
import { TIMELINE_CONFIG, _resetTimelineState } from '../../www/js/components/Timeline.lit.js';

describe('UTC Date Handling - April 1st Bug', () => {
  describe('parseDate and formatDate round-trip', () => {
    it('should correctly round-trip April 1st date', () => {
      // This test demonstrates the bug where April 1st might become March 31st
      // due to DST transition when using local time
      const dateStr = '2025-04-01';
      const parsed = parseDate(dateStr);
      const formatted = formatDate(parsed);
      
      // This should pass but may fail due to timezone issues
      expect(formatted).to.equal(dateStr, 
        `Expected ${dateStr} but got ${formatted}. ` +
        `The parseDate/formatDate round-trip should preserve the date exactly.`);
    });

    it('should correctly round-trip dates near DST transitions', () => {
      // Common DST transition dates to test
      const testDates = [
        '2025-03-30', // Often DST transition in Europe
        '2025-03-31',
        '2025-04-01',
        '2025-10-26', // Often DST transition in Europe (fall back)
        '2025-10-27',
        '2026-03-29',
        '2026-03-30',
        '2026-04-01',
      ];

      for (const dateStr of testDates) {
        const parsed = parseDate(dateStr);
        const formatted = formatDate(parsed);
        expect(formatted).to.equal(dateStr,
          `Date ${dateStr} failed round-trip: got ${formatted}`);
      }
    });

    it('should correctly handle first day of each month', () => {
      const months = [
        '2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01',
        '2025-05-01', '2025-06-01', '2025-07-01', '2025-08-01',
        '2025-09-01', '2025-10-01', '2025-11-01', '2025-12-01'
      ];

      for (const dateStr of months) {
        const parsed = parseDate(dateStr);
        const formatted = formatDate(parsed);
        expect(formatted).to.equal(dateStr,
          `First of month ${dateStr} failed round-trip: got ${formatted}`);
      }
    });
  });

  describe('Date positioning calculations', () => {
    it('should calculate correct month index for April 1st', () => {
      // Create month array starting from January
      const jan = parseDate('2025-01-01');
      const dec = parseDate('2025-12-01');
      const months = dateRangeInclusiveMonths(jan, dec);
      
      // April 1st should be in the 4th month (index 3)
      const april1 = parseDate('2025-04-01');
      
      // Find which month contains April 1st
      const aprilMs = april1.getTime();
      let foundIndex = -1;
      for (let i = 0; i < months.length; i++) {
        const monthStart = months[i];
        const nextMonthStart = i < months.length - 1 
          ? months[i + 1] 
          : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
        
        if (aprilMs >= monthStart.getTime() && aprilMs < nextMonthStart.getTime()) {
          foundIndex = i;
          break;
        }
      }
      
      expect(foundIndex).to.equal(3, 
        `April 1st should be in month index 3 (April), but found index ${foundIndex}. ` +
        `This indicates a timezone-related bug where April 1st is being placed in the wrong month.`);
    });

    it('should maintain date integrity when adding days near DST', () => {
      // Start from March 30 and add 2 days - should be April 1
      const march30 = parseDate('2025-03-30');
      const april1 = addDays(march30, 2);
      const formatted = formatDate(april1);
      
      expect(formatted).to.equal('2025-04-01',
        `Adding 2 days to March 30 should give April 1, got ${formatted}`);
    });

    it('should correctly calculate month boundaries across DST', () => {
      const march = parseDate('2025-03-01');
      const april = addMonths(march, 1);
      const formatted = formatDate(april);
      
      expect(formatted).to.equal('2025-04-01',
        `Adding 1 month to March 1 should give April 1, got ${formatted}`);
    });
  });

  describe('dateRangeInclusiveMonths UTC consistency', () => {
    it('should generate months consistently with UTC-based comparisons', () => {
      const start = parseDate('2025-01-01');
      const end = parseDate('2025-12-01');
      const months = dateRangeInclusiveMonths(start, end);
      
      expect(months).to.have.lengthOf(12);
      
      // Each month should be the first of the month
      const expectedMonths = [
        '2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01',
        '2025-05-01', '2025-06-01', '2025-07-01', '2025-08-01',
        '2025-09-01', '2025-10-01', '2025-11-01', '2025-12-01'
      ];
      
      for (let i = 0; i < months.length; i++) {
        const formatted = formatDate(months[i]);
        expect(formatted).to.equal(expectedMonths[i],
          `Month ${i} should be ${expectedMonths[i]}, got ${formatted}`);
      }
    });

    it('should not have duplicate or missing months due to DST', () => {
      const start = parseDate('2025-03-01');
      const end = parseDate('2025-05-01');
      const months = dateRangeInclusiveMonths(start, end);
      
      expect(months).to.have.lengthOf(3);
      expect(formatDate(months[0])).to.equal('2025-03-01');
      expect(formatDate(months[1])).to.equal('2025-04-01');
      expect(formatDate(months[2])).to.equal('2025-05-01');
    });
  });

  describe('Drag simulation - position to date conversion', () => {
    // Simulate the dateFromLeft function logic from dragManager.js
    function simulateDateFromLeft(months, monthWidth, px, boardOffset = 0) {
      const relative = (px - boardOffset) / monthWidth;
      let monthIndex = Math.floor(relative);
      let fraction = relative - monthIndex;
      if (monthIndex < 0) { monthIndex = 0; fraction = 0; }
      if (monthIndex >= months.length) { monthIndex = months.length - 1; fraction = 0.999; }
      const monthStart = months[monthIndex];
      const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
      let dayOffset = Math.round(fraction * (daysInMonth - 1));
      dayOffset = Math.max(0, Math.min(dayOffset, daysInMonth - 1));
      return new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 + dayOffset);
    }

    it('should convert pixel position to April 1st correctly', () => {
      const monthWidth = 120;
      const jan = parseDate('2025-01-01');
      const dec = parseDate('2025-12-01');
      const months = dateRangeInclusiveMonths(jan, dec);
      
      // Position at the start of April (index 3)
      // April is at pixel position: 3 * 120 = 360
      const aprilStartPx = 3 * monthWidth;
      
      const resultDate = simulateDateFromLeft(months, monthWidth, aprilStartPx);
      const formatted = formatDate(resultDate);
      
      expect(formatted).to.equal('2025-04-01',
        `Dragging to pixel ${aprilStartPx} (April 1 position) should give 2025-04-01, got ${formatted}`);
    });

    it('should handle fractional day positions within April', () => {
      const monthWidth = 120;
      const jan = parseDate('2025-01-01');
      const dec = parseDate('2025-12-01');
      const months = dateRangeInclusiveMonths(jan, dec);
      
      // Position at April 15 (index 3 + 14/30 of month)
      // April has 30 days, so day 15 is at fraction 14/30 ≈ 0.467
      const april15Px = 3 * monthWidth + (14 / 30) * monthWidth;
      
      const resultDate = simulateDateFromLeft(months, monthWidth, april15Px);
      const formatted = formatDate(resultDate);
      
      // Should be April 14 or 15 depending on rounding
      expect(formatted.startsWith('2025-04-')).to.be.true,
        `Position within April should give April date, got ${formatted}`;
    });
  });

  describe('Position to date and back - full round trip', () => {
    // This simulates the EXACT logic from board-utils.js which has the bug
    // The binary search uses days * 24 * 60 * 60 * 1000 to calculate month end,
    // but DST transitions cause some days to have 23 or 25 hours
    function simulateComputePositionWithDSTBug(feature, months, monthWidth, boardOffset = 0) {
      const startDate = parseDate(feature.start);
      const endDate = parseDate(feature.end);
      
      const ms = startDate.getTime();
      const ems = endDate.getTime();
      
      // Build cached arrays exactly like board-utils.js
      const cachedMonthStarts = months.map(m => m.getTime());
      const cachedMonthDays = months.map(m => new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate());
      
      // Binary search - THIS IS THE BUGGY LOGIC FROM board-utils.js
      function findMonthIndexFor(msVal) {
        const arr = cachedMonthStarts;
        let lo = 0, hi = arr.length - 1;
        if (msVal < arr[0]) return -1;
        if (msVal >= arr[hi]) return hi;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const midStart = arr[mid];
          // BUG: This calculation assumes 24 hours per day, but DST breaks this
          const midEnd = midStart + (cachedMonthDays[mid] * 24 * 60 * 60 * 1000);
          if (msVal >= midStart && msVal < midEnd) return mid;
          if (msVal < midStart) hi = mid - 1; else lo = mid + 1;
        }
        return -1;
      }
      
      let startIdx = findMonthIndexFor(ms);
      startIdx = startIdx < 0 ? (ms < cachedMonthStarts[0] ? 0 : months.length - 1) : startIdx;
      let endIdx = findMonthIndexFor(ems);
      endIdx = endIdx < 0 ? (ems < cachedMonthStarts[0] ? 0 : months.length - 1) : endIdx;

      const startDays = cachedMonthDays[startIdx];
      const endDays = cachedMonthDays[endIdx];
      const startFraction = (startDate.getDate() - 1) / startDays;
      const endFraction = (endDate.getDate()) / endDays;

      const left = boardOffset + (startIdx + startFraction) * monthWidth;
      const spanContinuous = (endIdx + endFraction) - (startIdx + startFraction);
      const width = spanContinuous * monthWidth;
      
      return { left, width, startIdx };
    }

    // NOTE: These tests demonstrate the OLD buggy behavior using a simulation of
    // the broken algorithm. They are kept for documentation but skipped since
    // the real implementation is now fixed.
    
    it.skip('[OLD BUG DEMO] April 1st gets wrong month index due to DST', () => {
      // This test demonstrates the actual bug that WAS in board-utils.js
      // In timezones with DST (like Europe/Copenhagen), March only has
      // ~30.96 days worth of milliseconds due to spring-forward.
      // The binary search incorrectly includes April 1 in March's range.
      
      const monthWidth = 120;
      const jan = parseDate('2025-01-01');
      const dec = parseDate('2025-12-01');
      const months = dateRangeInclusiveMonths(jan, dec);
      
      const feature = { start: '2025-04-01', end: '2025-04-30' };
      const pos = simulateComputePositionWithDSTBug(feature, months, monthWidth);
      
      // Expected: April is month index 3, left should be 360
      // Bug: In DST timezones, startIdx will be 2 (March), left will be 240
      const expectedLeft = 3 * monthWidth;
      
      // This assertion demonstrates the bug - it will PASS in UTC timezone
      // but FAIL in DST-affected timezones like Europe/Copenhagen
      expect(pos.startIdx).to.equal(3,
        `April 1 should be in month index 3 (April), got ${pos.startIdx}. ` +
        `This is the DST bug - April 1 is incorrectly placed in March.`);
      
      expect(pos.left).to.be.closeTo(expectedLeft, 1,
        `Feature starting April 1 should be at pixel ~${expectedLeft}, got ${pos.left}. ` +
        `This indicates the feature is being positioned in the wrong month.`);
    });

    it.skip('[OLD BUG DEMO] Round-trip fails in DST timezones', () => {
      const monthWidth = 120;
      const jan = parseDate('2025-01-01');
      const dec = parseDate('2025-12-01');
      const months = dateRangeInclusiveMonths(jan, dec);
      
      // Simulate a feature that was dragged to April 1
      const targetDate = '2025-04-01';
      const targetPx = 3 * monthWidth; // April starts at month index 3
      
      // Convert pixel to date (like dateFromLeft)
      const relative = targetPx / monthWidth;
      const monthIndex = Math.floor(relative);
      const monthStart = months[monthIndex];
      const resultDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
      const resultDateStr = formatDate(resultDate);
      
      expect(resultDateStr).to.equal(targetDate,
        `Dragging to April position should result in ${targetDate}, got ${resultDateStr}`);
      
      // Now compute position for that date (like computePosition)
      const feature = { start: resultDateStr, end: '2025-04-30' };
      const pos = simulateComputePositionWithDSTBug(feature, months, monthWidth);
      
      // This will fail in DST timezones due to the bug
      expect(pos.left).to.be.closeTo(targetPx, 1,
        `After round-trip, feature should be at ${targetPx}px, got ${pos.left}px. ` +
        `This shows the bug: dragging to April renders at wrong position.`);
    });
  });
  
  describe('FIXED: Real computePosition from board-utils.js', () => {
    beforeEach(() => {
      // Reset the cache before each test
      _test_resetCache();
      // Set the month width to a known value
      TIMELINE_CONFIG.monthWidth = 120;
    });
    
    it('should correctly position April 1st feature with fixed computePosition', () => {
      const monthWidth = 120;
      const jan = parseDate('2025-01-01');
      const dec = parseDate('2025-12-01');
      const months = dateRangeInclusiveMonths(jan, dec);
      
      const feature = { start: '2025-04-01', end: '2025-04-30' };
      const pos = computePosition(feature, months);
      
      // April is month index 3, first day fraction is 0
      // Expected left = 3 * 120 = 360
      const expectedLeft = 3 * monthWidth;
      
      expect(pos.left).to.be.closeTo(expectedLeft, 1,
        `Feature starting April 1 should be at pixel ~${expectedLeft}, got ${pos.left}. ` +
        `The fix should correctly handle DST transitions.`);
    });
    
    it('should correctly handle dates near DST transitions with fixed computePosition', () => {
      const monthWidth = 120;
      const jan = parseDate('2025-01-01');
      const dec = parseDate('2025-12-01');
      const months = dateRangeInclusiveMonths(jan, dec);
      
      // Test multiple dates near DST transitions
      const testCases = [
        { date: '2025-03-30', expectedMonthIdx: 2, desc: 'March 30 (before DST)' },
        { date: '2025-03-31', expectedMonthIdx: 2, desc: 'March 31 (DST day)' },
        { date: '2025-04-01', expectedMonthIdx: 3, desc: 'April 1 (after DST)' },
        { date: '2025-10-26', expectedMonthIdx: 9, desc: 'October 26 (before fall DST)' },
        { date: '2025-10-27', expectedMonthIdx: 9, desc: 'October 27 (fall DST)' },
      ];
      
      for (const tc of testCases) {
        const feature = { start: tc.date, end: tc.date };
        const pos = computePosition(feature, months);
        const expectedLeft = tc.expectedMonthIdx * monthWidth;
        
        // Allow some tolerance for day fraction
        expect(pos.left).to.be.at.least(expectedLeft,
          `${tc.desc}: Feature should be at or after month ${tc.expectedMonthIdx} start (${expectedLeft}px), got ${pos.left}px`);
        expect(pos.left).to.be.below(expectedLeft + monthWidth,
          `${tc.desc}: Feature should be within month ${tc.expectedMonthIdx} (before ${expectedLeft + monthWidth}px), got ${pos.left}px`);
      }
    });
  });
});
