import { expect } from '@open-wc/testing';
import { renderTaskView } from '../../www/js/plugins/PluginCostV2TaskView.js';

describe('PluginCostV2 Task View render paths', () => {
  it('returns an empty-state when no data present', () => {
    const res = renderTaskView({});
    expect(res).to.be.ok;
  });

  it('renders task-level empty table when no features', () => {
    const component = {
      months: [new Date('2026-01-01')],
      monthsMap: {},
      expandedTasks: new Set(),
      data: { features: [] },
    };
    const res = renderTaskView(component);
    expect(res).to.be.ok;
  });
});
