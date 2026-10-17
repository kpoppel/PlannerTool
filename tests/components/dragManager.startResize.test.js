import { expect } from '@open-wc/testing';
import { startResize } from '../../www/js/components/dragManager.js';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';

describe('startResize interactive', () => {
  it('cancels an active resize on scenario change without committing into the next scenario', () => {
    const previous = store.getState();
    const state = createInitialAppState();
    state.scenarios.items.push({ id: 'draft', readonly: false, overrides: {} });
    state.scenarios.activeId = 'draft';
    store.setState(state, true);
    const updates = [];
    const card = { style: { width: '200px' }, setLiveDates() {}, clearLiveDates() {} };
    try {
      startResize({ clientX: 100 }, { id: 'task', start: '2026-10-05', end: '2026-10-16' },
        card, null, (value) => updates.push(value), () => {});
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 170 }));
      store.setState((current) => ({ ...current, scenarios: { ...current.scenarios, activeId: 'baseline' } }));
      window.dispatchEvent(new MouseEvent('mouseup'));
      expect(updates).to.deep.equal([]);
      expect(card.style.width).to.equal('200px');
    } finally {
      store.setState(previous, true);
    }
  });

  it('startResize updates feature end on mousemove+mouseup', (done) => {
    // Create a fake feature and card
    const feature = {
      id: 'Fz',
      start: '2025-01-01',
      end: '2025-01-05',
      type: 'feature',
    };
    const card = {
      style: { width: '120px' },
      setLiveDates: function () {},
      clearLiveDates: function () {},
    };

    // capture updates passed to callback
    const updatesReceived = [];
    function updateDatesCb(updates) {
      updatesReceived.push(updates);
    }

    // startResize expects an event with clientX
    const startEvent = { clientX: 100 };
    startResize(startEvent, feature, card, null, updateDatesCb, () => {});

    // Simulate a mousemove to increase width
    const move = new MouseEvent('mousemove', { clientX: 200 });
    window.dispatchEvent(move);

    // Then mouseup to finalize
    const up = new MouseEvent('mouseup');
    window.dispatchEvent(up);

    return new Promise((resolve) =>
      setTimeout(() => {
        expect(updatesReceived).to.have.lengthOf(1);
        expect(updatesReceived[0][0].id).to.equal('Fz');
        resolve();
      }, 10)
    );
  }).timeout(2000);

  it('startResize epic clamps to child end and calls updateDates', (done) => {
    const epic = {
      id: 'E',
      type: 'epic',
      start: '2025-01-01',
      end: '2025-01-20',
    };
    const child = {
      id: 'c1',
      parentId: 'E',
      start: '2025-01-05',
      end: '2025-01-25',
    };
    const card = {
      style: { width: '200px' },
      setLiveDates: () => {},
      clearLiveDates: () => {},
    };
    const updates = [];
    startResize({ clientX: 0 }, epic, card, null, (u) => updates.push(u), () => {});
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    return new Promise((resolve) =>
      setTimeout(() => {
        // For epic, when resized earlier than child end, clamp should cause an update
        expect(updates).to.have.lengthOf(1);
        expect(updates[0][0].id).to.equal('E');
        resolve();
      }, 10)
    );
  }).timeout(2000);
});
