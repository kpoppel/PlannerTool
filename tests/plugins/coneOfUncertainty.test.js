import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCOPES, addMonths, buildForecast, projectEvents, selectPlanTasks, validateScopes,
} from '../../www/js/plugins/coneOfUncertainty.js';

const task = (id, start, end, extra = {}) => ({
  id, title: id, project: 'p1', parentId: null, start, end, ...extra,
});

describe('cone of uncertainty model', () => {
  it('projects only global and selected-plan events without changing the forecast', () => {
    const forecast = buildForecast([], '2027-01-01', DEFAULT_SCOPES);
    const before = JSON.stringify(forecast);
    const events = [
      { id: 'global', title: 'Global', date: '2027-02-01', plan_id: '' },
      { id: 'selected', title: 'Selected', date: '2027-02-02', plan_id: 'p1', end_date: '' },
      { id: 'other', title: 'Other', date: '2027-02-03', plan_id: 'p2' },
    ];
    expect(projectEvents(events, ['p1'], forecast).map(({ event }) => event.id))
      .toEqual(['global', 'selected']);
    expect(projectEvents(events, [], forecast).map(({ event }) => event.id)).toEqual(['global']);
    expect(projectEvents(events, ['p1', 'p2'], forecast)).toHaveLength(3);
    expect(JSON.stringify(forecast)).toBe(before);
  });

  it('clips overlapping event ranges and excludes points outside the UTC axis', () => {
    const forecast = buildForecast([], '2027-01-01', DEFAULT_SCOPES);
    const events = [
      { id: 'left', title: 'Left', date: '2026-01-01', end_date: '2027-02-01', plan_id: '' },
      { id: 'right', title: 'Right', date: '2030-12-01', end_date: '2032-01-01', plan_id: '' },
      { id: 'past', title: 'Past', date: '2026-09-30', plan_id: '' },
      { id: 'end', title: 'End', date: '2031-01-02', plan_id: '' },
      { id: 'same', title: 'Same day', date: '2027-03-01', end_date: '2027-03-01', plan_id: '' },
    ];
    const projected = projectEvents(events, [], forecast);
    expect(projected.map(({ event }) => event.id)).toEqual(['left', 'same', 'right']);
    expect(projected[0].start).toEqual(forecast.axisStart);
    expect(projected[2].end).toEqual(forecast.rangeEnd);
    expect(projected[1].start).toEqual(projected[1].end);
    expect(projected[1].start.toISOString()).toBe('2027-03-01T00:00:00.000Z');
  });

  it('reports malformed event dates rather than silently dropping annotations', () => {
    const forecast = buildForecast([], '2027-01-01', DEFAULT_SCOPES);
    for (const dates of [
      { date: '2027-02-30' },
      { date: '2027-02-01', end_date: '2027-01-01' },
    ]) {
      expect(() => projectEvents([{ id: 'bad', title: 'Bad', plan_id: '', ...dates }], [], forecast))
        .toThrow('Invalid dates for event bad');
    }
  });

  it('uses the requested three default scopes', () => {
    expect(DEFAULT_SCOPES).toEqual([
      { endMonth: 6, lower: -10, upper: 30 },
      { endMonth: 18, lower: -25, upper: 75 },
      { endMonth: 48, lower: -40, upper: 150 },
    ]);
  });

  it('starts the visualization three months before the fixed forecast origin', () => {
    const forecast = buildForecast([], '2027-01-11', DEFAULT_SCOPES);
    expect(forecast.origin.toISOString().slice(0, 10)).toBe('2027-01-11');
    expect(forecast.axisStart.toISOString().slice(0, 10)).toBe('2026-10-11');
  });

  it('extends the visible past to include task starts earlier than the three-month context', () => {
    const forecast = buildForecast([
      task('active', '2026-06-15', '2026-12-15', { stateCategory: 'InProgress' }),
    ], '2026-11-17', DEFAULT_SCOPES);
    expect(forecast.axisStart.toISOString().slice(0, 10)).toBe('2026-06-15');
  });

  it('adds calendar months without overflowing month ends or leap days', () => {
    expect(addMonths('2028-01-31', 1).toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(addMonths('2028-02-29', 12).toISOString().slice(0, 10)).toBe('2029-02-28');
  });

  it('selects scopes by start, with exact boundaries assigned to the next scope', () => {
    const forecast = buildForecast([
      task('first', '2027-01-01', '2027-01-10'),
      task('second', '2027-07-01', '2027-07-10'),
      task('third', '2028-07-01', '2028-07-10'),
      task('outside', '2031-01-01', '2031-01-10'),
    ], '2027-01-01', DEFAULT_SCOPES);
    expect(forecast.rows.map((row) => row.scopeIndex)).toEqual([0, 1, 2]);
    expect(forecast.outsideCount).toBe(1);
    expect(forecast.rows[0].earliest.toISOString().slice(0, 10)).toBe('2027-01-09');
    expect(forecast.rows[0].latest.toISOString().slice(0, 10)).toBe('2027-01-13');
    expect(forecast.rows[1].earliest.toISOString().slice(0, 10)).toBe('2027-07-07');
    expect(forecast.rows[1].latest.toISOString().slice(0, 10)).toBe('2027-07-18');
    expect(forecast.rows[2].latest.toISOString().slice(0, 10)).toBe('2028-07-25');
  });

  it('keeps ongoing work unmodeled, reports invalid dates and extends for forecast tails', () => {
    const forecast = buildForecast([
      task('ongoing', '2026-12-01', '2027-02-01'),
      task('past', '2026-10-01', '2026-11-01'),
      task('tail', '2030-12-01', '2031-12-01'),
      task('undated', '', ''),
      task('reversed', '2027-03-01', '2027-02-01'),
      task('invalid', '2027-02-30', '2027-03-10'),
    ], '2027-01-01', DEFAULT_SCOPES);
    expect(forecast.rows.map((row) => row.feature.id)).toEqual(['ongoing', 'tail']);
    expect(forecast.rows[0].scopeIndex).toBe(-1);
    expect(forecast.rows[0].earliest).toBeNull();
    expect(forecast.invalidCount).toBe(3);
    expect(forecast.outsideCount).toBe(1);
    expect(forecast.rangeEnd.getTime()).toBeGreaterThan(
      forecast.rows[1].latest.getTime()
    );
  });

  it('models active work from the forecast origin using its remaining duration', () => {
    const scopes = DEFAULT_SCOPES.map((scope) => ({ ...scope, lower: -50, upper: 50 }));
    const forecast = buildForecast([
      task('active', '2027-01-01', '2027-01-20', { stateCategory: 'InProgress' }),
      task('proposed', '2027-01-01', '2027-01-20', { stateCategory: 'Proposed' }),
    ], '2027-01-11', scopes);
    const active = forecast.rows.find((row) => row.feature.id === 'active');
    const proposed = forecast.rows.find((row) => row.feature.id === 'proposed');
    expect(active.scopeIndex).toBe(0);
    expect(active.earliest.toISOString().slice(0, 10)).toBe('2027-01-15');
    expect(active.latest.toISOString().slice(0, 10)).toBe('2027-01-25');
    expect(proposed.scopeIndex).toBe(-1);
    expect(proposed.earliest).toBeNull();
  });

  it('handles one-day tasks and does not mutate tasks or settings', () => {
    const tasks = [task('milestone', '2027-01-01', '2027-01-01')];
    const before = JSON.stringify({ tasks, scopes: DEFAULT_SCOPES });
    const { rows } = buildForecast(tasks, '2027-01-01', DEFAULT_SCOPES);
    expect(rows[0].earliest <= rows[0].end).toBe(true);
    expect(rows[0].latest >= rows[0].end).toBe(true);
    expect(JSON.stringify({ tasks, scopes: DEFAULT_SCOPES })).toBe(before);
  });

  it('does not round exact percentage results to an extra day', () => {
    const scopes = DEFAULT_SCOPES.map((scope) => ({ ...scope, lower: -90, upper: 10 }));
    const { rows } = buildForecast([task('hundred-days', '2027-01-01', '2027-04-10')],
      '2027-01-01', scopes);
    expect(rows[0].earliest.toISOString().slice(0, 10)).toBe('2027-01-10');
    expect(rows[0].latest.toISOString().slice(0, 10)).toBe('2027-04-20');
  });

  it('uses modified calendar scope boundaries and percentages in the actual forecast', () => {
    const scopes = [
      { endMonth: 3, lower: -50, upper: 100 },
      { endMonth: 12, lower: -20, upper: 50 },
      { endMonth: 60, lower: -10, upper: 20 },
    ];
    const { rows } = buildForecast([task('second', '2027-04-01', '2027-04-10'),
      task('third', '2028-01-01', '2028-01-10')], '2027-01-01', scopes);
    expect(rows.map((row) => row.scopeIndex)).toEqual([1, 2]);
    expect(rows[0].earliest.toISOString().slice(0, 10)).toBe('2027-04-08');
    expect(rows[0].latest.toISOString().slice(0, 10)).toBe('2027-04-15');
    expect(rows[1].latest.toISOString().slice(0, 10)).toBe('2028-01-12');
  });

  it('rejects malformed or unordered settings instead of masking them', () => {
    for (const scopes of [
      [], null, [{ endMonth: 6, lower: -10, upper: 30 }],
      DEFAULT_SCOPES.map((scope) => ({ ...scope, endMonth: 6 })),
      DEFAULT_SCOPES.map((scope) => ({ ...scope, lower: -101 })),
      DEFAULT_SCOPES.map((scope) => ({ ...scope, lower: 1 })),
      DEFAULT_SCOPES.map((scope) => ({ ...scope, upper: -1 })),
      DEFAULT_SCOPES.map((scope) => ({ ...scope, endMonth: 1.5 })),
      DEFAULT_SCOPES.map((scope) => ({ ...scope, upper: Infinity })),
    ]) expect(() => validateScopes(scopes)).toThrow();
    expect(() => buildForecast([], 'not-a-date', DEFAULT_SCOPES)).toThrow();
  });

  it('selects only plan roots by default, without promoting children through search', () => {
    const tasks = [
      task('root', '', ''),
      task('child', '', '', { parentId: 'root' }),
      task('orphan', '', '', { parentId: 'not-loaded' }),
      task('other', '', '', { project: 'p2' }),
      task('context', '', '', { ancestorOnly: true }),
      task('shared', '', '', { project: 'p2', sourcePlanIds: ['p1', 'p2'] }),
    ];
    expect(selectPlanTasks(tasks, ['p1'], true, '').map((item) => item.id))
      .toEqual(['orphan', 'root', 'shared']);
    expect(selectPlanTasks(tasks, ['p1'], true, 'child')).toEqual([]);
    expect(selectPlanTasks(tasks, ['p1'], false, 'CHILD').map((item) => item.id))
      .toEqual(['child']);
    expect(selectPlanTasks(tasks, [], false, '')).toEqual([]);
  });
});
