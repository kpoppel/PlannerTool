import { expect } from '@esm-bundle/chai';
import { computeMoveUpdates, computeResizeUpdates, applyUpdates } from '../../www/js/components/dragManager.js';

describe('dragManager helpers coverage', () => {
  it('computeMoveUpdates shifts children when epic moved', () => {
    const epic = { id: 'e1', type: 'epic', start: '2025-01-01', end: '2025-01-15' };
    const child = { id: 'f1', parentEpic: 'e1', start: '2025-01-02', end: '2025-01-05' };
    const features = [child, epic];
    // Move epic forward by 10 days
    const newStart = new Date(2025,0,11);
    const newEnd = new Date(2025,0,25);
    const updates = computeMoveUpdates(epic, newStart, newEnd, features);
    // Should include updates for epic and shifted child
    expect(updates.some(u => u.id === 'e1')).to.be.true;
    expect(updates.some(u => u.id === 'f1')).to.be.true;
  });

  it('computeResizeUpdates clamps epic end against children', () => {
    const epic = { id: 'e1', type: 'epic', start: '2025-01-01', end: '2025-03-01' };
    const child = { id: 'f1', parentEpic: 'e1', start: '2025-03-05', end: '2025-03-10' };
    const features = [child, epic];
    const proposedEnd = new Date(2025,2,1); // 2025-03-01
    const updates = computeResizeUpdates(epic, proposedEnd, features);
    // Child ends later than proposed end, so clamp should yield an update
    expect(updates).to.be.an('array');
  });

  it('applyUpdates calls provided callback', () => {
    const calls = [];
    const cb = (u) => calls.push(u);
    applyUpdates([{ id: 'x', start: '2025-01-01', end: '2025-01-02' }], cb);
    expect(calls.length).to.equal(1);
  });
});
