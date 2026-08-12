import { expect } from '@open-wc/testing';
import { vi } from 'vitest';

const mockSel = vi.hoisted(() => ({
  selection: {
    getSelectedProjects: vi.fn(() => []),
  },
  feature: {
    getChildrenByParentMap: vi.fn(() => new Map()),
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  sel: mockSel,
}));

import { renderProjectView } from '../../www/js/plugins/PluginCostProjectView.js';

describe('PluginCost project view render paths', () => {
  it('returns an empty state when no data is present', () => {
    const res = renderProjectView({});
    expect(res.strings.join('')).to.include('No cost data available');
  });

  it('renders the no-features state for a selected project without data', () => {
    mockSel.selection.getSelectedProjects.mockReturnValue([{ id: 'p1', name: 'Plan 1' }]);

    const res = renderProjectView({
      data: {
        projects: {
          p1: { id: 'p1', features: [] },
        },
      },
      months: [new Date('2026-01-01')],
    });

    expect(mockSel.selection.getSelectedProjects.mock.calls.length).to.equal(1);
    expect(res).to.exist;
  });
});