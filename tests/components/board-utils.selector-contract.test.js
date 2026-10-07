import { expect } from '@esm-bundle/chai';
import { vi } from 'vitest';

const mockView = vi.hoisted(() => ({
  condensedCards: false,
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {},
  sel: {
    view: {
      getCondensedCards: () => mockView.condensedCards,
      getTimelineScale: () => 'months',
      getContext: () => ({ dependency: false }),
    },
  },
}));

import {
  computePosition, laneHeight, getBoardZoom, setBoardZoom,
} from '../../www/js/components/board-utils.js';

describe('board-utils selector seam', () => {
  beforeEach(() => {
    mockView.condensedCards = false;
    setBoardZoom(1);
  });

  it('returns normal lane height when condensed cards are disabled', () => {
    expect(laneHeight()).to.equal(64);
  });

  it('returns compact lane height when condensed cards are enabled', () => {
    mockView.condensedCards = true;
    expect(laneHeight()).to.equal(28);
  });

  it('scales lane height with board zoom instead of a CSS transform', () => {
    setBoardZoom(0.5);
    expect(getBoardZoom()).to.equal(0.5);
    expect(laneHeight()).to.equal(32);

    mockView.condensedCards = true;
    setBoardZoom(0.75);
    expect(laneHeight()).to.equal(21);
  });

  it('positions an anchor on its historical date without assigning schedule dates', () => {
    const months = Array.from({ length: 12 }, (_, monthIndex) => new Date(2026, monthIndex, 1));
    const anchor = {
      state: 'Closed',
      start: null,
      end: null,
      presentation: { renderType: 'anchor', date: '2026-05-19', sourceState: 'Closed' },
    };

    expect(computePosition(anchor, months)).to.deep.equal(computePosition({
      start: '2026-05-19',
      end: '2026-05-19',
    }, months));
    expect(anchor.start).to.equal(null);
    expect(anchor.end).to.equal(null);
  });
});
