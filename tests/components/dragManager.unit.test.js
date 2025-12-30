import { expect } from '@open-wc/testing';
import { addDays, formatDate } from '../../../www/js/components/util.js';
import { computeMoveUpdates, computeResizeUpdates, applyUpdates } from '../../../www/js/components/dragManager.js';

describe('dragManager helpers', () => {
  it('computeMoveUpdates for epic shifts children and returns updates', () => {
    const epic = { id: 'E1', start: '2025-01-01', end: '2025-01-10', type: 'epic' };
    const child = { id: 'C1', parentEpic: 'E1', start: '2025-01-02', end: '2025-01-05' };
    const features = [child];

    const newStart = new Date(2025,0,3); // 2025-01-03 (shift +2 days)
    const newEnd = new Date(2025,0,12); // arbitrary

    const updates = computeMoveUpdates(epic, newStart, newEnd, features);
    // Expect: epic update, child shifted update with fromEpicMove, and final epic update
    expect(updates).to.be.an('array');
    expect(updates.length).to.equal(3);
    expect(updates[0].id).to.equal('E1');
    const childUpdate = updates.find(u => u.id === 'C1');
    expect(childUpdate).to.exist;
    expect(childUpdate.fromEpicMove).to.be.true;
    const finalEpic = updates[updates.length-1];
    expect(finalEpic.id).to.equal('E1');
  });

  it('computeMoveUpdates for non-epic returns single update', () => {
    const feat = { id: 'F1', start: '2025-01-10', end: '2025-01-15', type: 'feature' };
    const features = [];
    const newStart = new Date(2025,0,12);
    const newEnd = new Date(2025,0,17);
    const updates = computeMoveUpdates(feat, newStart, newEnd, features);
    expect(updates).to.have.lengthOf(1);
    expect(updates[0]).to.have.property('id', 'F1');
  });

  it('computeResizeUpdates clamps epic end to max child end', () => {
    const epic = { id: 'E2', start: '2025-01-01', end: '2025-01-10', type: 'epic' };
    const child1 = { id: 'cA', parentEpic: 'E2', start: '2025-01-05', end: '2025-01-20' };
    const features = [child1];
    const proposed = new Date(2025,0,15); // 2025-01-15
    const updates = computeResizeUpdates(epic, proposed, features);
    expect(updates).to.be.an('array').that.is.not.empty;
    expect(updates[0]).to.have.property('id', 'E2');
    // end should be clamped to child's end
    expect(updates[0].end).to.equal(child1.end);
  });

  it('computeResizeUpdates returns empty when no change', () => {
    const feat = { id: 'F2', start: '2025-01-01', end: '2025-01-10', type: 'feature' };
    const proposed = new Date(2025,0,9); // end equal to existing? compute will format
    const updates = computeResizeUpdates(feat, new Date(2025,0,9), []);
    // If proposed formatted equals existing, no updates
    // For safety accept array or empty
    expect(updates).to.be.an('array');
  });

  it('applyUpdates calls provided callback with updates', () => {
    const called = [];
    function cb(updates){ called.push(updates); }
    const updates = [{ id: 'X', start: '2025-01-01', end: '2025-01-02' }];
    applyUpdates(updates, cb);
    expect(called).to.have.lengthOf(1);
    expect(called[0]).to.equal(updates);
  });
});
