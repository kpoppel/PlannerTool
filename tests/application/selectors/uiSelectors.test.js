import { describe, it, expect } from 'vitest';
import { uiSelectors } from '../../../www/js/application/selectors/uiSelectors.js';

describe('application/selectors/uiSelectors', () => {
  it('returns false when debug flag is missing', () => {
    expect(uiSelectors.debugFlag({ view: { options: {} } })).toBe(false);
  });

  it('rejects state without required view options', () => {
    expect(() => uiSelectors.debugFlag({})).toThrow(TypeError);
  });

  it('returns boolean value from view options', () => {
    expect(uiSelectors.debugFlag({ view: { options: { debugFlag: 1 } } })).toBe(true);
    expect(uiSelectors.debugFlag({ view: { options: { debugFlag: 0 } } })).toBe(false);
  });
});
