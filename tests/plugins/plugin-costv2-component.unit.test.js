import { expect } from '@open-wc/testing';
import { render } from '../../www/js/vendor/lit.js';
import '../../www/js/plugins/PluginCostV2Component.js';

describe('PluginCostV2Component basic', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('constructor defaults', () => {
    const el = document.createElement('plugin-cost-v2');
    expect(el.activeView).to.equal('project');
    expect(el.viewMode).to.equal('cost');
    expect(el.loading).to.equal(false);
    expect(el.error).to.equal(null);
    expect(el.expandedProjects).to.be.instanceOf(Set);
    expect(el.expandedTasks).to.be.instanceOf(Set);
  });

  it('view change and mode change', () => {
    const el = document.createElement('plugin-cost-v2');
    el.handleViewChange('task');
    expect(el.activeView).to.equal('task');
    el.handleViewModeChange('hours');
    expect(el.viewMode).to.equal('hours');
  });

  it('toggle and setProjectView', () => {
    const el = document.createElement('plugin-cost-v2');
    el.expandedProjects = new Set();
    el.toggleProject('p1');
    expect(el.expandedProjects.has('p1')).to.be.true;
    el.toggleProject('p1');
    expect(el.expandedProjects.has('p1')).to.be.false;

    el.projectViewSelection = {};
    el.setProjectView('p1', 'teams');
    expect(el.projectViewSelection['p1']).to.equal('teams');
    el.setProjectView('p1', 'teams');
    expect(el.projectViewSelection['p1']).to.equal(undefined);
  });

  it('renderToolbar shows view toggles for team and project', () => {
    const el = document.createElement('plugin-cost-v2');
    // team view toggles always shown
    el.activeView = 'team';
    el.viewMode = 'cost';
    const tpl = el.renderToolbar();
    const container = document.createElement('div');
    render(tpl, container);
    const html = container.innerHTML;
    expect(html).to.include('Cost');
    expect(html).to.include('Hours');
    expect(html).to.include('Close');

    // project view: show toggles only when project has selection
    el.activeView = 'project';
    el.expandedProjects = new Set(['p1']);
    el.projectViewSelection = { p1: 'teams' };
    const tpl2 = el.renderToolbar();
    const c2 = document.createElement('div');
    render(tpl2, c2);
    expect(c2.innerHTML).to.include('Cost');
    expect(c2.innerHTML).to.include('Hours');
  });
});
