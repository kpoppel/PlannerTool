import { expect } from '@open-wc/testing';

import { computeMoveUpdates, computeResizeUpdates, applyUpdates } from '../../www/js/components/dragManager.js';
import { formatDate, addDays, parseDate } from '../../www/js/components/util.js';

describe('dragManager helpers', () => {
  it('computeMoveUpdates for feature returns single update', () => {
    const feature = { id: 'f1', start: '2025-01-01', end: '2025-01-10', type: 'feature' };
    const newStart = parseDate('2025-01-05');
    const newEnd = parseDate('2025-01-14');
    const updates = computeMoveUpdates(feature, newStart, newEnd, []);
    expect(updates).to.have.lengthOf(1);
    expect(updates[0].id).to.equal('f1');
    expect(updates[0].start).to.equal(formatDate(newStart));
    expect(updates[0].end).to.equal(formatDate(newEnd));
  });

  it('computeMoveUpdates for epic shifts children and includes epic twice', () => {
    const epic = { id: 'ep1', start: '2025-01-01', end: '2025-01-10', type: 'epic' };
    const child1 = { id: 'c1', parentEpic: 'ep1', start: '2025-01-03', end: '2025-01-05' };
    const child2 = { id: 'c2', parentEpic: 'ep1', start: '2025-01-06', end: '2025-01-08' };
    const features = [child1, child2];
    // move epic by +2 days
    const newStart = addDays(parseDate(epic.start), 2);
    const newEnd = addDays(parseDate(epic.end), 2);
    const updates = computeMoveUpdates(epic, newStart, newEnd, features);
    // expect: epic update, two child updates, epic update (final)
    expect(updates.length).to.equal(1 + 2 + 1);
    expect(updates[0].id).to.equal('ep1');
    // child updates should be shifted by 2 days
    const childUpdate = updates[1];
    expect(childUpdate.id).to.equal('c1');
    const expectedChild1Start = formatDate(addDays(parseDate(child1.start), 2));
    expect(childUpdate.start).to.equal(expectedChild1Start);
    // final entry should be epic again
    expect(updates[updates.length-1].id).to.equal('ep1');
  });

  it('computeResizeUpdates clamps epic end against children', () => {
    const epic = { id: 'epX', start: '2025-01-01', end: '2025-06-01', type: 'epic' };
    const child = { id: 'ch1', parentEpic: 'epX', start: '2025-05-01', end: '2025-08-01' };
    const proposedEnd = parseDate('2025-04-15');
    const updates = computeResizeUpdates(epic, proposedEnd, [child]);
    // Because child ends later, epic end should be clamped to child's end
    expect(updates).to.have.lengthOf(1);
    expect(updates[0].id).to.equal('epX');
    expect(updates[0].end).to.equal(child.end);
  });

  it('computeResizeUpdates returns empty for unchanged end', () => {
    const feat = { id: 'f2', start: '2025-01-01', end: '2025-02-01', type: 'feature' };
    const newEnd = parseDate(feat.end);
    const updates = computeResizeUpdates(feat, newEnd, []);
    expect(updates).to.have.lengthOf(0);
  });

  it('applyUpdates invokes callback with updates', () => {
    const calls = [];
    const cb = (u) => { calls.push(u); };
    const updates = [{ id: 'a', start: '2025-01-01', end: '2025-01-02' }];
    applyUpdates(updates, cb);
    expect(calls).to.have.lengthOf(1);
    expect(calls[0]).to.equal(updates);
  });
});
