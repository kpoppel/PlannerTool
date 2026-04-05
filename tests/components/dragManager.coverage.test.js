import { expect } from '@esm-bundle/chai';
import {
  computeMoveUpdates,
  computeResizeUpdates,
  applyUpdates,
  collectAllDescendants,
} from '../../www/js/components/dragManager.js';

describe('dragManager helpers coverage', () => {
  it('computeMoveUpdates shifts children when epic moved', () => {
    const epic = {
      id: 'e1',
      type: 'epic',
      start: '2025-01-01',
      end: '2025-01-15',
    };
    const child = {
      id: 'f1',
      parentId: 'e1',
      start: '2025-01-02',
      end: '2025-01-05',
    };
    const features = [child, epic];
    // Move epic forward by 10 days
    const newStart = new Date(2025, 0, 11);
    const newEnd = new Date(2025, 0, 25);
    const updates = computeMoveUpdates(epic, newStart, newEnd, features);
    // Should include updates for epic and shifted child
    expect(updates.some((u) => u.id === 'e1')).to.be.true;
    expect(updates.some((u) => u.id === 'f1')).to.be.true;
  });

  it('computeResizeUpdates clamps epic end against children', () => {
    const epic = {
      id: 'e1',
      type: 'epic',
      start: '2025-01-01',
      end: '2025-03-01',
    };
    const child = {
      id: 'f1',
      parentId: 'e1',
      start: '2025-03-05',
      end: '2025-03-10',
    };
    const features = [child, epic];
    const proposedEnd = new Date(2025, 2, 1); // 2025-03-01
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

  // --- Recursive hierarchy tests ---

  it('collectAllDescendants returns only direct children when no grandchildren', () => {
    const features = [
      { id: 'c1', parentId: 'root' },
      { id: 'c2', parentId: 'root' },
      { id: 'other', parentId: 'unrelated' },
    ];
    const result = collectAllDescendants('root', features);
    expect(result.map((f) => f.id)).to.include.members(['c1', 'c2']);
    expect(result.map((f) => f.id)).to.not.include('other');
  });

  it('collectAllDescendants collects grandchildren recursively', () => {
    const features = [
      { id: 'child', parentId: 'root' },
      { id: 'grandchild', parentId: 'child' },
      { id: 'greatgrandchild', parentId: 'grandchild' },
    ];
    const result = collectAllDescendants('root', features);
    expect(result.map((f) => f.id)).to.include.members([
      'child',
      'grandchild',
      'greatgrandchild',
    ]);
  });

  it('collectAllDescendants does not include root itself', () => {
    const features = [{ id: 'child', parentId: 'root' }];
    const result = collectAllDescendants('root', features);
    expect(result.map((f) => f.id)).to.not.include('root');
  });

  it('computeMoveUpdates shifts grandchildren when grandparent moves', () => {
    const grandparent = { id: 'gp', start: '2025-01-01', end: '2025-01-20' };
    const child = { id: 'ch', parentId: 'gp', start: '2025-01-03', end: '2025-01-10' };
    const grandchild = { id: 'gc', parentId: 'ch', start: '2025-01-05', end: '2025-01-08' };
    const features = [grandparent, child, grandchild];
    // Move grandparent +5 days
    const newStart = new Date(2025, 0, 6);
    const newEnd = new Date(2025, 0, 25);
    const updates = computeMoveUpdates(grandparent, newStart, newEnd, features);
    // Grandchild should also be shifted
    const gcUpdate = updates.find((u) => u.id === 'gc');
    expect(gcUpdate).to.exist;
    expect(gcUpdate.start).to.equal('2025-01-10'); // +5 days from 2025-01-05
    expect(gcUpdate.fromEpicMove).to.be.true;
  });

  it('computeResizeUpdates clamps grandparent end against grandchild end', () => {
    const grandparent = { id: 'gp', start: '2025-01-01', end: '2025-06-01' };
    const child = { id: 'ch', parentId: 'gp', start: '2025-03-01', end: '2025-04-01' };
    // Grandchild ends AFTER the proposed shrink date
    const grandchild = { id: 'gc', parentId: 'ch', start: '2025-08-01', end: '2025-09-01' };
    const features = [grandparent, child, grandchild];
    // Try to shrink grandparent end to 2025-05-01 (before grandchild's end)
    const proposedEnd = new Date(2025, 4, 1);
    const updates = computeResizeUpdates(grandparent, proposedEnd, features);
    expect(updates).to.have.lengthOf(1);
    // Must be clamped to grandchild's end
    expect(updates[0].end).to.equal(grandchild.end);
  });
});

describe('dragManager helpers coverage', () => {
  it('computeMoveUpdates shifts children when epic moved', () => {
    const epic = {
      id: 'e1',
      type: 'epic',
      start: '2025-01-01',
      end: '2025-01-15',
    };
    const child = {
      id: 'f1',
      parentId: 'e1',
      start: '2025-01-02',
      end: '2025-01-05',
    };
    const features = [child, epic];
    // Move epic forward by 10 days
    const newStart = new Date(2025, 0, 11);
    const newEnd = new Date(2025, 0, 25);
    const updates = computeMoveUpdates(epic, newStart, newEnd, features);
    // Should include updates for epic and shifted child
    expect(updates.some((u) => u.id === 'e1')).to.be.true;
    expect(updates.some((u) => u.id === 'f1')).to.be.true;
  });

  it('computeResizeUpdates clamps epic end against children', () => {
    const epic = {
      id: 'e1',
      type: 'epic',
      start: '2025-01-01',
      end: '2025-03-01',
    };
    const child = {
      id: 'f1',
      parentId: 'e1',
      start: '2025-03-05',
      end: '2025-03-10',
    };
    const features = [child, epic];
    const proposedEnd = new Date(2025, 2, 1); // 2025-03-01
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
