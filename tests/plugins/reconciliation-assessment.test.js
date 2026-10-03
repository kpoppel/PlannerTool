import { describe, expect, it } from 'vitest';
import { assessReconciliation } from '../../www/js/plugins/reconciliation/assessment.js';

const task = (id, values = {}) => ({
  id, title: `Task ${id}`, project: 'project', type: 'Feature', state: 'Active',
  start: '2026-10-01', end: '2026-10-10', parentId: null, capacity: [], relations: [],
  ...values,
});
const assess = (features, scopeIds, sourceFeatures = features) => assessReconciliation({
  features, sourceFeatures, scopeIds: new Set(scopeIds), today: '2026-10-03',
  projects: [{ id: 'project', name: 'Programme', type: 'project', container_order: 0,
    state_categories: { Closed: 'Completed', Active: 'InProgress', New: 'Proposed' } }],
  hierarchy: [{ types: ['Epic'] }, { types: ['Feature'] }, { types: ['Task'] }],
});

describe('Reconciliation assessment', () => {
  it('detects a hidden ancestor and deduplicates a relationship when both ends are scoped', () => {
    const features = [task('parent', { type: 'Epic' }),
      task('child', { parentId: 'parent', end: '2026-10-22' })];
    const hidden = assess(features, ['child']).filter((issue) => issue.category === 'schedule');
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toMatchObject({ featureId: 'child', relatedId: 'parent',
      lateDays: 12, earlyDays: 0, change: 'existing', path: ['child', 'parent'] });
    expect(assess(features, ['parent', 'child']).filter((issue) => issue.category === 'schedule'))
      .toHaveLength(1);
  });

  it('finds descendants beyond an unplanned intermediate task', () => {
    const features = [task('root', { type: 'Epic' }),
      task('middle', { parentId: 'root', start: null, end: null }),
      task('leaf', { type: 'Task', parentId: 'middle', start: '2026-09-29' })];
    const issue = assess(features, ['root']).find((entry) => entry.category === 'schedule');
    expect(issue).toMatchObject({ featureId: 'leaf', relatedId: 'root', earlyDays: 2,
      path: ['leaf', 'middle', 'root'] });
  });

  it('distinguishes new and worsened conflicts from existing conflicts', () => {
    const source = [task('parent', { type: 'Epic' }), task('child', { parentId: 'parent' })];
    const proposed = [source[0], { ...source[1], end: '2026-10-12' }];
    expect(assess(proposed, ['child'], source).find((issue) => issue.category === 'schedule').change)
      .toBe('new');
    expect(assess([{ ...source[0], end: '2026-10-08' }, proposed[1]], ['parent'], proposed)
      .find((issue) => issue.category === 'schedule').change).toBe('worsened');
  });

  it('does not call unloaded parents or natural roots orphaned', () => {
    const issues = assess([task('root', { type: 'Epic' }),
      task('child', { parentId: 'unloaded' }), task('unlinked')], ['root', 'child', 'unlinked']);
    expect(issues.filter((issue) => issue.type === 'missing-parent').map((issue) => issue.featureId))
      .toEqual(['unlinked']);
    expect(issues.find((issue) => issue.featureId === 'child')).toMatchObject({
      type: 'unavailable-parent', severity: 'info',
    });
    expect(issues.some((issue) => issue.featureId === 'root')).toBe(false);
  });

  it('uses configured completion states and reports invalid date ranges', () => {
    const issues = assess([task('done', { state: 'Closed', end: '2026-10-02' }),
      task('late', { end: '2026-10-02' }),
      task('invalid', { start: '2026-10-12' })], ['done', 'late', 'invalid']);
    expect(issues.filter((issue) => issue.type === 'past-unfinished').map((issue) => issue.featureId))
      .toEqual(['late']);
    expect(issues.find((issue) => issue.type === 'invalid-dates').severity).toBe('error');
  });

  it('terminates cycles, ignores unrelated projects, and counts calendar days across DST', () => {
    const features = [task('first', { parentId: 'second', start: '2026-03-28' }),
      task('second', { parentId: 'first', start: '2026-03-30' }),
      task('unrelated', { start: '2026-12-20', end: '2026-01-01' })];
    const issues = assess(features, ['first']);
    expect(issues.some((issue) => issue.type === 'hierarchy-cycle')).toBe(true);
    expect(issues.find((issue) => issue.category === 'schedule').earlyDays).toBe(2);
    expect(issues.some((issue) => issue.featureId === 'unrelated')).toBe(false);
  });

  it('preserves team allocation and dependency diagnostics with hidden context', () => {
    const features = [task('parent', { type: 'Epic', capacity: [{ team: 'one' }] }),
      task('child', { parentId: 'parent', capacity: [{ team: 'two' }],
        relations: [{ id: 'predecessor', type: 'Predecessor' }] }),
      task('predecessor', { start: '2026-10-05' })];
    const issues = assess(features, ['parent', 'child']);
    expect(issues.find((issue) => issue.type === 'team-allocation')).toBeDefined();
    expect(issues.find((issue) => issue.type === 'dependency-order')).toMatchObject({
      featureId: 'child', relatedId: 'predecessor',
    });
  });

  it('uses configured container levels for same-type cross-plan anchoring', () => {
    const features = [task('programme', { type: 'Epic', project: 'program' }),
      task('anchored', { type: 'Epic', project: 'squad', parentId: 'programme' }),
      task('unanchored', { type: 'Epic', project: 'squad' })];
    const projects = [{ id: 'program', container_order: 0, state_categories: {} },
      { id: 'squad', container_order: 1, state_categories: {} }];
    const issues = assessReconciliation({ features, sourceFeatures: features,
      scopeIds: new Set(['anchored', 'unanchored']), today: '2026-10-03', projects,
      hierarchy: [{ types: ['Epic'] }] });
    expect(issues.some((issue) => issue.featureId === 'anchored')).toBe(false);
    expect(issues.find((issue) => issue.featureId === 'unanchored').type).toBe('unanchored-root');
  });

  it.each([
    ['Epic', 'Feature', false], ['Feature', 'Task', false],
    ['Epic', 'Epic', true], ['Feature', 'Epic', true], ['Task', 'Task', true],
  ])('preserves hierarchy checks for %s above %s', (parentType, childType, invalid) => {
    const features = [task('parent', { type: parentType }),
      task('child', { type: childType, parentId: 'parent' })];
    expect(assess(features, ['child']).some((issue) => issue.type === 'hierarchy-type')).toBe(invalid);
  });

  it('does not change root status when a higher-level task is hidden', () => {
    const features = [task('root', { type: 'Epic' }), task('unlinked', { type: 'Task' })];
    expect(assess(features, ['unlinked']).find((issue) => issue.type === 'missing-parent')).toBeDefined();
    expect(assess(features, ['root']).some((issue) => issue.type === 'missing-parent')).toBe(false);
  });

  it('skips hierarchy checks for unknown types or unconfigured hierarchies', () => {
    const features = [task('parent', { type: 'Custom' }), task('child', { parentId: 'parent' })];
    expect(assess(features, ['child']).some((issue) => issue.type === 'hierarchy-type')).toBe(false);
    const issues = assessReconciliation({ features, sourceFeatures: features, scopeIds: new Set(['child']),
      today: '2026-10-03', projects: [], hierarchy: [] });
    expect(issues.some((issue) => issue.type === 'hierarchy-type')).toBe(false);
  });

  it('compares a scenario with its source independently of baseline overrides', () => {
    const source = [task('parent', { type: 'Epic' }), task('child', { parentId: 'parent' })];
    const changed = [source[0], { ...source[1], end: '2026-10-22' }];
    expect(assess(changed, ['child'], source).find((issue) => issue.category === 'schedule').change)
      .toBe('new');
    expect(assess(source, ['child']).some((issue) => issue.category === 'schedule')).toBe(false);
  });
});