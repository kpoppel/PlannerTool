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

import { laneHeight, getBoardZoom, setBoardZoom } from '../../www/js/components/board-utils.js';

describe('board-utils Phase 4 selector seam', () => {
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
});
