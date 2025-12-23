// tests/unit/test-mainGraph-geometry.test.js
// Unit tests for mainGraph geometry computations

import { expect } from '@open-wc/testing';

describe('MainGraph Geometry', () => {
  // Helper functions extracted from mainGraph.js for testing
  function dateToIndex(months, date) {
    const start = months[0];
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.floor((date - start) / msPerDay);
  }

  function indexToDate(months, idx) {
    const start = months[0];
    const msPerDay = 24 * 60 * 60 * 1000;
    return new Date(start.getTime() + (idx * msPerDay));
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function daysInMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  }

  function hexToRgba(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) { return `rgba(231,76,60,${alpha})`; }
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  describe('dateToIndex', () => {
    it('should calculate day index from first month', () => {
      const months = [new Date('2025-01-01'), new Date('2025-02-01')];
      const date = new Date('2025-01-15');
      const index = dateToIndex(months, date);
      expect(index).to.equal(14); // 14 days from Jan 1
    });

    it('should return 0 for first day of first month', () => {
      const months = [new Date('2025-01-01')];
      const date = new Date('2025-01-01');
      const index = dateToIndex(months, date);
      expect(index).to.equal(0);
    });

    it('should handle dates spanning multiple months', () => {
      const months = [new Date('2025-01-01'), new Date('2025-02-01')];
      const date = new Date('2025-02-15');
      const index = dateToIndex(months, date);
      expect(index).to.equal(45); // 31 days of Jan + 14 days into Feb
    });
  });

  describe('indexToDate', () => {
    it('should convert index back to date', () => {
      const months = [new Date('2025-01-01')];
      const date = indexToDate(months, 14);
      expect(date.getDate()).to.equal(15);
      expect(date.getMonth()).to.equal(0); // January
    });

    it('should handle index 0', () => {
      const months = [new Date('2025-01-01')];
      const date = indexToDate(months, 0);
      expect(date.getDate()).to.equal(1);
      expect(date.getMonth()).to.equal(0);
    });

    it('should be inverse of dateToIndex', () => {
      const months = [new Date('2025-01-01')];
      const originalDate = new Date('2025-01-20');
      const index = dateToIndex(months, originalDate);
      const reconstructedDate = indexToDate(months, index);
      expect(reconstructedDate.getDate()).to.equal(originalDate.getDate());
      expect(reconstructedDate.getMonth()).to.equal(originalDate.getMonth());
    });
  });

  describe('clamp', () => {
    it('should return value if within range', () => {
      expect(clamp(5, 0, 10)).to.equal(5);
    });

    it('should return min if value below range', () => {
      expect(clamp(-5, 0, 10)).to.equal(0);
    });

    it('should return max if value above range', () => {
      expect(clamp(15, 0, 10)).to.equal(10);
    });

    it('should handle edge values', () => {
      expect(clamp(0, 0, 10)).to.equal(0);
      expect(clamp(10, 0, 10)).to.equal(10);
    });
  });

  describe('daysInMonth', () => {
    it('should return 31 for January', () => {
      expect(daysInMonth(new Date('2025-01-15'))).to.equal(31);
    });

    it('should return 28 for February in non-leap year', () => {
      expect(daysInMonth(new Date('2025-02-15'))).to.equal(28);
    });

    it('should return 29 for February in leap year', () => {
      expect(daysInMonth(new Date('2024-02-15'))).to.equal(29);
    });

    it('should return 30 for April', () => {
      expect(daysInMonth(new Date('2025-04-15'))).to.equal(30);
    });

    it('should return 31 for December', () => {
      expect(daysInMonth(new Date('2025-12-15'))).to.equal(31);
    });
  });

  describe('hexToRgba', () => {
    it('should convert hex to rgba', () => {
      const result = hexToRgba('#ff0000', 0.5);
      expect(result).to.equal('rgba(255, 0, 0, 0.5)');
    });

    it('should handle hex without hash', () => {
      const result = hexToRgba('00ff00', 1.0);
      expect(result).to.equal('rgba(0, 255, 0, 1)');
    });

    it('should handle lowercase hex', () => {
      const result = hexToRgba('#0000ff', 0.8);
      expect(result).to.equal('rgba(0, 0, 255, 0.8)');
    });

    it('should return fallback for invalid hex', () => {
      const result = hexToRgba('invalid', 0.5);
      expect(result).to.equal('rgba(231,76,60,0.5)');
    });

    it('should handle mixed case hex', () => {
      const result = hexToRgba('#AbCdEf', 0.9);
      expect(result).to.equal('rgba(171, 205, 239, 0.9)');
    });
  });
});
