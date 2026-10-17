import { displayFixture } from '../helpers/workItemDisplay.js';
import { describe, expect, it, vi } from 'vitest';
import { projectPublication, publishScenario } from '../../www/js/components/scenarioPublication.js';
import { sel } from '../../www/js/application/imports.js';

const task = (id, project, values = {}) => ({ process_id: 'process', id, project, title: `Task ${id}`,
  type: 'Feature', state: 'Active', start: '2026-10-01', end: '2026-10-10',
  parentId: null, capacity: [], relations: [], ...values });
const projects = ['own', 'other'].map((id) => ({ id, name: id, container_order: 0,
  work_item_display: displayFixture(undefined, { Active: 'InProgress' }) }));
const context = { projects, hierarchy: [{ types: ['Feature'] }], today: '2026-10-03' };

describe('Scenario publication projection', () => {
  it('rejects read-only publication before loading a review or making writes', async () => {
    const access = vi.spyOn(sel.scenario, 'getScenarioAccess').mockReturnValue({ canEdit: false, reason: 'read-only' });
    try {
      expect(await publishScenario({ id: 'locked' })).toMatchObject({ ok: false,
        error: { code: 'scenario_read_only' } });
    } finally { access.mockRestore(); }
  });

  it('distinguishes an indirect foreign-plan impact from an actual foreign write', () => {
    const source = [task('a', 'own'), task('b', 'other', { parentId: 'a' })];
    const review = projectPublication({ ...context, source, referencePlanIds: ['own'],
      overrides: { a: { end: '2026-10-05' }, b: { state: 'Done' } },
      selected: new Set(['a:end']) });
    expect(review.writes.map((entry) => entry.id)).toEqual(['a']);
    expect(review.writes[0].classification).toBe('reference-plan');
    expect(review.crossPlan.map((entry) => entry.id)).toContain('b');
    expect(review.crossPlan.find((entry) => entry.id === 'b').written).toBe(false);
    expect(review.findings.some((entry) => entry.type === 'containment')).toBe(true);
    expect(review.resulting.find((entry) => entry.id === 'b').state).toBe('Active');
  });

  it('classifies explicit foreign writes separately and retains local-only edits', () => {
    const review = projectPublication({ ...context, source: [task('b', 'other')],
      referencePlanIds: ['own'], overrides: { b: { state: 'Done', note: 'Local draft' } },
      selected: new Set(['b:state']) });
    expect(review.writes[0].classification).toBe('foreign-plan');
    expect(review.localOnly).toEqual([{ id: 'b', fields: ['note'] }]);
  });

  it('keeps cross-plan impacts visible when both plans are in the review scope', () => {
    const source = [task('a', 'own'), task('b', 'other', { parentId: 'a' })];
    const review = projectPublication({ ...context, source, referencePlanIds: ['own', 'other'],
      overrides: { a: { end: '2026-10-05' } }, selected: new Set(['a:end']) });
    expect(review.crossPlan.find((entry) => entry.id === 'b')).toMatchObject({ written: false });
  });

  it('rejects source tasks missing from a reviewed publication', () => {
    expect(() => projectPublication({ ...context, source: [], referencePlanIds: [],
      overrides: { missing: { state: 'Done' } }, selected: new Set(['missing:state']) }))
      .toThrow('Source task missing is unavailable');
  });

  it('omits reconciliation assessment and impact when disabled without changing task writes', () => {
    const review = projectPublication({ ...context, source: [task('b', 'other')],
      referencePlanIds: ['own'], overrides: { b: { state: 'Done', note: 'Local draft' } },
      selected: new Set(['b:state']), includeReconciliation: false });
    expect(review.writes).toHaveLength(1);
    expect(review.resulting[0].state).toBe('Done');
    expect(review.localOnly).toEqual([{ id: 'b', fields: ['note'] }]);
    expect(review.crossPlan).toEqual([]);
    expect(review.findings).toEqual([]);
  });
});