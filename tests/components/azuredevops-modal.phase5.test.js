import { describe, expect, it, vi } from 'vitest';

const mockCmd = vi.hoisted(() => ({
  feature: {
    revertFeature: vi.fn(),
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: mockCmd,
  sel: {},
}));

import { AzureDevopsModal } from '../../www/js/components/AzureDevopsModal.lit.js';

describe('AzureDevopsModal phase 5 feature seam', () => {
  it('reverts through cmd.feature and clears selected feature cells', () => {
    const modal = new AzureDevopsModal();
    modal.requestUpdate = vi.fn();
    modal._selected = new Set(['f-1:start', 'f-1:end', 'f-2:state']);

    modal._onRevertFeature('f-1');

    expect(mockCmd.feature.revertFeature).toHaveBeenCalledWith('f-1');
    expect(modal._selected.has('f-1:start')).toBe(false);
    expect(modal._selected.has('f-1:end')).toBe(false);
    expect(modal._selected.has('f-2:state')).toBe(true);
    expect(modal.requestUpdate).toHaveBeenCalled();
  });
});
