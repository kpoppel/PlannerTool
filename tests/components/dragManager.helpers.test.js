import { expect } from '@open-wc/testing';
import { computeMoveUpdates, computeResizeUpdates, applyUpdates } from '../../www/js/components/dragManager.js';

describe('dragManager helpers', () => {
  it('computeMoveUpdates shifts children when epic moves', () => {
    const epic = { id: 'E', type: 'epic', start: '2025-01-01', end: '2025-01-05' };
    const child = { id: 'C1', parentEpic: 'E', start: '2025-01-02', end: '2025-01-03' };
    const newStart = new Date(2025, 0, 3); // 2025-01-03
    const newEnd = new Date(2025, 0, 7); // 2025-01-07
    const updates = computeMoveUpdates(epic, newStart, newEnd, [child]);
    // Expect updates to include epic and shifted child
    const ids = updates.map(u => u.id);
    expect(ids).to.include.members(['E','C1']);
    const childUpdate = updates.find(u => u.id === 'C1');
    expect(childUpdate).to.have.property('fromEpicMove', true);
  });

  it('computeResizeUpdates clamps epic end against children', () => {
    const epic = { id: 'E', type: 'epic', start: '2025-01-01', end: '2025-01-10' };
    const child = { id: 'C1', parentEpic: 'E', start: '2025-01-05', end: '2025-01-15' };
    const newEndDate = new Date(2025, 0, 8); // earlier than child end
    const updates = computeResizeUpdates(epic, newEndDate, [child]);
    // Since new end is before child end, clamp should push to child's end
    expect(updates).to.have.lengthOf(1);
    expect(updates[0].end).to.equal('2025-01-15');
  });

  it('applyUpdates calls provided callback with updates', () => {
    let called = false;
    const updater = (u) => { called = true; expect(u).to.be.an('array'); };
    applyUpdates([{ id: 'x', start: '2025-01-01', end: '2025-01-02' }], updater);
    expect(called).to.be.true;
  });
});
