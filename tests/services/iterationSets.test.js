import { describe, expect, it } from 'vitest';
import { generateIterations } from '../../www/admin/js/services/iterationSets.js';

const settings = { start: '2026-10-19', end: '2026-11-20', length: 2, unit: 'weeks',
  count: 3, mode: 'count', prefix: 'Iteration', firstNumber: 1 };

describe('iteration date generation', () => {
  it('uses contiguous inclusive dates', () => {
    expect(generateIterations(settings).map(({ startDate, finishDate }) => [startDate, finishDate]))
      .toEqual([['2026-10-19', '2026-11-01'], ['2026-11-02', '2026-11-15'], ['2026-11-16', '2026-11-29']]);
  });
  it('clips the last iteration to the end date', () => {
    expect(generateIterations({ ...settings, mode: 'until' }).at(-1))
      .toMatchObject({ startDate: '2026-11-16', finishDate: '2026-11-20' });
  });
  it('does not create an extra iteration at an exact boundary', () => {
    expect(generateIterations({ ...settings, mode: 'until', end: '2026-11-15' })).toHaveLength(2);
  });
  it('supports one-day ranges and configurable names', () => {
    expect(generateIterations({ ...settings, mode: 'until', end: settings.start, prefix: 'Cycle', firstNumber: 8 }))
      .toEqual([{ path: 'generated-8', name: 'Cycle 8', startDate: '2026-10-19', finishDate: '2026-10-19' }]);
  });
  it('handles leap days and daylight-saving boundaries', () => {
    expect(generateIterations({ ...settings, start: '2028-02-28', length: 2, unit: 'days' })[1])
      .toMatchObject({ startDate: '2028-03-01', finishDate: '2028-03-02' });
    expect(generateIterations({ ...settings, start: '2026-03-28', length: 2, unit: 'days' })[1])
      .toMatchObject({ startDate: '2026-03-30', finishDate: '2026-03-31' });
  });
  it.each([{ length: 0 }, { count: 0 }, { count: 521 }, { length: 1.5 },
    { start: '2026-02-30' }, { mode: 'until', end: '2026-10-18' },
    { mode: 'until', end: '2029-01-01', length: 1, unit: 'days' }])
  ('rejects invalid settings: %j', (change) => expect(() => generateIterations({ ...settings, ...change })).toThrow());
});