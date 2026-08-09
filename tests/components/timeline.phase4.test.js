import { expect } from '@esm-bundle/chai';
import { vi } from 'vitest';

const mockView = vi.hoisted(() => ({
  timelineScale: 'months',
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {},
  sel: {
    view: {
      getTimelineScale: () => mockView.timelineScale,
      getCondensedCards: () => false,
      getShowDependencies: () => false,
    },
  },
}));

import {
  initTimeline,
  TIMELINE_CONFIG,
  _resetTimelineState,
  getMonthWidthForScale,
} from '../../www/js/components/Timeline.lit.js';

describe('Timeline Phase 4 selector seam', () => {
  beforeEach(() => {
    _resetTimelineState();
    document.body.innerHTML = '';
    mockView.timelineScale = 'months';
  });

  afterEach(() => {
    _resetTimelineState();
    document.body.innerHTML = '';
  });

  it('uses sel.view timeline scale during initialization', async () => {
    mockView.timelineScale = 'years';

    const board = document.createElement('timeline-board');
    const timeline = document.createElement('timeline-lit');
    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'scroll-container';
    scrollContainer.style.width = '900px';

    board.appendChild(timeline);
    board.appendChild(scrollContainer);
    document.body.appendChild(board);

    await initTimeline();

    expect(TIMELINE_CONFIG.monthWidth).to.equal(getMonthWidthForScale('years'));
  });
});
