import { expect } from '@open-wc/testing';
import { renderProjectView as renderProjectViewTemplate } from '../../www/js/plugins/PluginCostProjectView.js';

function renderProjectView(component) {
  component.api = {
    selection: { getProjects: () => [{ id: 'p1', name: 'P1', selected: true }], getChildrenByParent: () => new Map() },
    filters: { getTaskFilters: () => ({ schedule: { unplanned: true } }) },
  };
  return renderProjectViewTemplate(component);
}

describe('PluginCost Project View render paths', () => {
  it('returns an empty-state when no data present', () => {
    const res = renderProjectView({});
    expect(res).to.be.ok;
  });

  it('renders project-level empty table when project selected but no features', () => {
    const component = {
      months: [new Date('2026-01-01')],
      monthsMap: {},
      expandedProjects: new Set(),
      projectViewSelection: {},
      data: { projects: { p1: { id: 'p1', features: [] } } },
    };

    const res = renderProjectView(component);
    expect(res).to.be.ok;
  });
});
