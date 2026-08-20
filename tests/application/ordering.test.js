import { describe, expect, it } from 'vitest';
import {
  RANK_GAP,
  computeInsertRank,
  rankBetween,
  rebalanceRanks,
  sortByRank,
} from '../../www/js/application/shared/ordering.js';

const mk = (id, rank) => ({ id, rank });

describe('application/shared/ordering', () => {
  describe('rankBetween', () => {
    it('returns the base gap for an empty list', () => {
      expect(rankBetween(null, null)).toBe(RANK_GAP);
    });

    it('halves the first rank when inserting at the head', () => {
      expect(rankBetween(null, 1024)).toBe(512);
    });

    it('appends a full gap past the last rank', () => {
      expect(rankBetween(2048, null)).toBe(2048 + RANK_GAP);
    });

    it('returns the midpoint between two neighbours', () => {
      expect(rankBetween(1024, 2048)).toBe(1536);
    });

    it('returns null when there is no room between neighbours', () => {
      expect(rankBetween(1024, 1025)).toBeNull();
      expect(rankBetween(1024, 1024)).toBeNull();
    });

    it('returns null when there is no room before the first rank', () => {
      expect(rankBetween(null, 1)).toBeNull();
      expect(rankBetween(null, 0)).toBeNull();
    });

    it('throws when a rank is not an integer', () => {
      expect(() => rankBetween(1.5, null)).toThrow(/integer/i);
      expect(() => rankBetween(null, 'x')).toThrow(/integer/i);
    });
  });

  describe('sortByRank', () => {
    it('orders ascending by rank without mutating the input', () => {
      const input = [mk('b', 2048), mk('a', 1024)];
      const sorted = sortByRank(input);
      expect(sorted.map((s) => s.id)).toEqual(['a', 'b']);
      expect(input.map((s) => s.id)).toEqual(['b', 'a']);
    });

    it('breaks rank ties by id so the order is deterministic', () => {
      const sorted = sortByRank([mk('b', 0), mk('a', 0)]);
      expect(sorted.map((s) => s.id)).toEqual(['a', 'b']);
    });

    it('throws when a sibling has no integer rank', () => {
      expect(() => sortByRank([mk('a', undefined)])).toThrow(/rank/i);
    });
  });

  describe('rebalanceRanks', () => {
    it('respaces siblings onto the base gap preserving order', () => {
      expect(rebalanceRanks([mk('b', 5), mk('a', 1), mk('c', 9)])).toEqual([
        { id: 'a', rank: RANK_GAP },
        { id: 'b', rank: 2 * RANK_GAP },
        { id: 'c', rank: 3 * RANK_GAP },
      ]);
    });

    it('returns an empty list for no siblings', () => {
      expect(rebalanceRanks([])).toEqual([]);
    });
  });

  describe('computeInsertRank', () => {
    it('assigns the base gap to the first group of a plan', () => {
      expect(computeInsertRank([], null)).toEqual({ rank: RANK_GAP, rebalance: [] });
    });

    it('inserts before the first sibling when afterId is null', () => {
      const siblings = [mk('a', 1024), mk('b', 2048)];
      expect(computeInsertRank(siblings, null)).toEqual({ rank: 512, rebalance: [] });
    });

    it('inserts between two siblings', () => {
      const siblings = [mk('a', 1024), mk('b', 2048)];
      expect(computeInsertRank(siblings, 'a')).toEqual({ rank: 1536, rebalance: [] });
    });

    it('appends after the last sibling', () => {
      const siblings = [mk('a', 1024), mk('b', 2048)];
      expect(computeInsertRank(siblings, 'b')).toEqual({ rank: 3072, rebalance: [] });
    });

    it('rebalances and still lands between the neighbours when the gap is exhausted', () => {
      const siblings = [mk('a', 1024), mk('b', 1025)];
      const result = computeInsertRank(siblings, 'a');
      expect(result.rebalance).toEqual([
        { id: 'a', rank: RANK_GAP },
        { id: 'b', rank: 2 * RANK_GAP },
      ]);
      expect(result.rank).toBeGreaterThan(RANK_GAP);
      expect(result.rank).toBeLessThan(2 * RANK_GAP);
    });

    it('rebalances legacy siblings that all share rank 0', () => {
      const siblings = [mk('a', 0), mk('b', 0), mk('c', 0)];
      const result = computeInsertRank(siblings, 'b');
      expect(result.rebalance).toHaveLength(3);
      expect(result.rank).toBeGreaterThan(2 * RANK_GAP);
      expect(result.rank).toBeLessThan(3 * RANK_GAP);
    });

    it('survives repeated midpoint inserts at the same slot', () => {
      let siblings = [mk('a', RANK_GAP), mk('z', 2 * RANK_GAP)];
      for (let i = 0; i < 40; i++) {
        const { rank, rebalance } = computeInsertRank(siblings, 'a');
        const byId = new Map(rebalance.map((entry) => [entry.id, entry.rank]));
        siblings = siblings.map((s) => (byId.has(s.id) ? mk(s.id, byId.get(s.id)) : s));
        siblings.push(mk(`n${i}`, rank));
      }
      const order = sortByRank(siblings).map((s) => s.id);
      expect(order[0]).toBe('a');
      expect(order[order.length - 1]).toBe('z');
      expect(new Set(siblings.map((s) => s.rank)).size).toBe(siblings.length);
    });

    it('throws when afterId is not among the siblings', () => {
      expect(() => computeInsertRank([mk('a', 1024)], 'nope')).toThrow(/nope/);
    });
  });
});
