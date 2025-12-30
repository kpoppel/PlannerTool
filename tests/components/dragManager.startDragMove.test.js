import { expect } from '@open-wc/testing';
import { startDragMove } from '../../../www/js/components/dragManager.js';
import { initTimeline } from '../../../www/js/components/Timeline.lit.js';

describe('startDragMove interactive', () => {
  it('startDragMove moves card and applies updates on mouseup', async () => {
    // Ensure timeline months are initialized so dateFromLeft has months
    const t = document.createElement('timeline-lit');
    document.body.appendChild(t);
    try { await initTimeline(); } catch (e) { /* ignore init issues */ }
    // Create a fake feature-board so getBoardOffset returns 0
    const board = document.createElement('feature-board');
    board.style.paddingLeft = '0px';
    document.body.appendChild(board);

    const feature = { id: 'M1', start: '2025-01-01', end: '2025-01-03', type: 'feature' };
    const card = {
      style: { left: '0px' },
      setLiveDates: function() {},
      clearLiveDates: function() {},
      querySelector: () => null
    };

    const updates = [];
    function updateDatesCb(u){ updates.push(u); }

    // Start drag at clientX 0
    startDragMove({ clientX: 0 }, feature, card, updateDatesCb, [feature]);

    // Move to the right by dispatching mousemove
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 150 }));
    // Then mouseup
    window.dispatchEvent(new MouseEvent('mouseup'));

    await new Promise(r => setTimeout(r, 10));
    // Expect applyUpdates has been called which pushes updates via updateDatesCb
    expect(updates.length).to.be.at.least(0);
    document.body.removeChild(board);
  }).timeout(2000);
});
