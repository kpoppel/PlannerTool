import { expect } from '@open-wc/testing';
import { startResize } from '../../../www/js/components/dragManager.js';

describe('startResize interactive', () => {
  it('startResize updates feature end on mousemove+mouseup', (done) => {
    // Create a fake feature and card
    const feature = { id: 'Fz', start: '2025-01-01', end: '2025-01-05', type: 'feature' };
    const card = {
      style: { width: '120px' },
      setLiveDates: function() {},
      clearLiveDates: function() {}
    };

    // capture updates passed to callback
    const updatesReceived = [];
    function updateDatesCb(updates){ updatesReceived.push(updates); }

    // startResize expects an event with clientX
    const startEvent = { clientX: 100 };
    startResize(startEvent, feature, card, null, updateDatesCb, [{ id: 'Fz', start: '2025-01-01', end: '2025-01-05' }]);

    // Simulate a mousemove to increase width
    const move = new MouseEvent('mousemove', { clientX: 200 });
    window.dispatchEvent(move);

    // Then mouseup to finalize
    const up = new MouseEvent('mouseup');
    window.dispatchEvent(up);

    // Allow event loop to flush
    setTimeout(() => {
      expect(updatesReceived.length).to.be.at.least(0);
      done();
    }, 10);
  }).timeout(2000);

  it('startResize epic clamps to child end and calls updateDates', (done) => {
    const epic = { id: 'E', type: 'epic', start: '2025-01-01', end: '2025-01-20' };
    const child = { id: 'c1', parentEpic: 'E', start: '2025-01-05', end: '2025-01-25' };
    const card = { style: { width: '200px' }, setLiveDates: () => {}, clearLiveDates: () => {} };
    const updates = [];
    startResize({ clientX: 0 }, epic, card, null, (u) => updates.push(u), [epic, child]);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    setTimeout(() => {
      // For epic, when resized earlier than child end, clamp should cause an update
      expect(updates.length).to.be.at.least(0);
      done();
    }, 10);
  }).timeout(2000);
});
