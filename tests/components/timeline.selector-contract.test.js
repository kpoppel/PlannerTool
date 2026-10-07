import { expect } from '@esm-bundle/chai';
import { vi } from 'vitest';

const mockView = vi.hoisted(() => ({
  timelineScale: 'months',
  features: [],
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {},
  sel: {
    feature: {
      getEffectiveFeatures: () => mockView.features,
    },
    view: {
      getTimelineScale: () => mockView.timelineScale,
      getCondensedCards: () => false,
      getContext: () => ({ dependency: false }),
    },
  },
}));

import {
  initTimeline,
  TIMELINE_CONFIG,
  _resetTimelineState,
  getMonthWidthForScale,
  getTimelineMonths,
} from '../../www/js/components/Timeline.lit.js';

describe('Timeline selector seam', () => {
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

  it('includes historical anchor dates in the timeline range', async () => {
    mockView.features = [{
      state: 'Closed',
      start: null,
      end: null,
      presentation: { renderType: 'anchor', date: '2022-06-15', sourceState: 'Closed' },
    }];
    const board = document.createElement('timeline-board');
    const timeline = document.createElement('timeline-lit');
    board.appendChild(timeline);
    document.body.appendChild(board);

    await initTimeline();

    expect(getTimelineMonths().some((month) =>
      month.getFullYear() === 2022 && month.getMonth() === 5
    )).to.equal(true);
  });
});
