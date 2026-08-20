/**
 * ordering.js
 *
 * Sparse sibling-scoped ordering keys for the board tree.
 *
 * Every orderable node (group today, task in a later phase) carries an integer
 * `rank` that orders it among its siblings only — never globally.  Ranks are
 * spaced `RANK_GAP` apart so an insertion between two neighbours is a single
 * midpoint write instead of a bulk re-numbering.  When repeated midpoint
 * inserts exhaust the gap, the caller respaces that one sibling list.
 *
 * All functions are pure and fail fast on malformed input — a missing or
 * non-integer rank is a bug, not a case to paper over with a default.
 */

/** Spacing between consecutive sibling ranks. */
export const RANK_GAP = 1024;

function assertRank(value, label) {
  if (!Number.isInteger(value)) {
    throw new Error(`ordering: ${label} must be an integer rank, got ${String(value)}`);
  }
}

/**
 * Compute a rank strictly between two neighbouring ranks.
 *
 * @param {number|null} prevRank  Rank of the sibling above, or null at the head
 * @param {number|null} nextRank  Rank of the sibling below, or null at the tail
 * @returns {number|null} The new rank, or null when the neighbours leave no room
 */
export function rankBetween(prevRank, nextRank) {
  if (prevRank !== null) assertRank(prevRank, 'prevRank');
  if (nextRank !== null) assertRank(nextRank, 'nextRank');

  if (prevRank === null && nextRank === null) return RANK_GAP;
  if (prevRank === null) {
    if (nextRank < 2) return null;
    return Math.floor(nextRank / 2);
  }
  if (nextRank === null) return prevRank + RANK_GAP;
  if (nextRank - prevRank < 2) return null;
  return Math.floor((prevRank + nextRank) / 2);
}

/**
 * Sort siblings ascending by rank, breaking ties by id so the order is stable
 * across renders even for legacy data where every rank is the same value.
 *
 * @template {{ id: string|number, rank: number }} T
 * @param {T[]} siblings
 * @returns {T[]} A new array
 */
export function sortByRank(siblings) {
  for (const sibling of siblings) assertRank(sibling.rank, `rank of '${String(sibling.id)}'`);
  return [...siblings].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Respace a sibling list onto clean `RANK_GAP` multiples, preserving order.
 *
 * @param {{ id: string|number, rank: number }[]} siblings
 * @returns {{ id: string|number, rank: number }[]} Ranks to persist
 */
export function rebalanceRanks(siblings) {
  return sortByRank(siblings).map((sibling, index) => ({
    id: sibling.id,
    rank: (index + 1) * RANK_GAP,
  }));
}

/**
 * Compute the rank for a node inserted directly after `afterId` within a
 * sibling list.  When the neighbours leave no room, the whole sibling list is
 * respaced and the returned `rebalance` entries must be persisted alongside
 * the new node.
 *
 * @param {{ id: string|number, rank: number }[]} siblings  Siblings under the target parent
 * @param {string|number|null} afterId  Insert after this sibling; null inserts at the head
 * @returns {{ rank: number, rebalance: { id: string|number, rank: number }[] }}
 */
export function computeInsertRank(siblings, afterId) {
  const indexOfAfter = (list) => {
    if (afterId === null || afterId === undefined) return -1;
    const idx = list.findIndex((sibling) => String(sibling.id) === String(afterId));
    if (idx === -1) throw new Error(`ordering: afterId '${String(afterId)}' is not a sibling`);
    return idx;
  };

  const sorted = sortByRank(siblings);
  const after = indexOfAfter(sorted);
  const prevRank = after === -1 ? null : sorted[after].rank;
  const nextRank = after + 1 < sorted.length ? sorted[after + 1].rank : null;

  const rank = rankBetween(prevRank, nextRank);
  if (rank !== null) return { rank, rebalance: [] };

  const rebalance = rebalanceRanks(sorted);
  const rebalancedAfter = indexOfAfter(rebalance);
  const rebalancedPrev = rebalancedAfter === -1 ? null : rebalance[rebalancedAfter].rank;
  const rebalancedNext =
    rebalancedAfter + 1 < rebalance.length ? rebalance[rebalancedAfter + 1].rank : null;

  const rebalancedRank = rankBetween(rebalancedPrev, rebalancedNext);
  if (rebalancedRank === null) {
    throw new Error('ordering: no room for insertion even after rebalancing');
  }
  return { rank: rebalancedRank, rebalance };
}
