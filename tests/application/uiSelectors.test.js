import { describe, it, expect } from 'vitest';
import { uiSelectors } from '../../www/js/application/selectors/uiSelectors.js';

describe('application/selectors/uiSelectors', () => {
  it('returns false when debug flag is missing', () => {
    expect(uiSelectors.debugFlag({})).toBe(false);
  });

  it('returns boolean value from view options', () => {
    expect(uiSelectors.debugFlag({ view: { options: { debugFlag: 1 } } })).toBe(true);
    expect(uiSelectors.debugFlag({ view: { options: { debugFlag: 0 } } })).toBe(false);
  });
});
