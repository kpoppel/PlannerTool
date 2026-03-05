import { expect } from '@esm-bundle/chai';
import '../../www/js/components/Sidebar.lit.js';
import { state } from '../../www/js/services/State.js';

describe('app-sidebar', () => {
  let sidebar;
  beforeEach(() => {
    sidebar = document.createElement('app-sidebar');
    document.body.appendChild(sidebar);
  });

  afterEach(() => {
    if(sidebar) sidebar.remove();
  });

  it('toggleProject calls state.setProjectSelected with flipped value', () => {
    state._projectTeamService.initFromBaseline([{ id: 'p1' }], []);
    let called = null;
    const orig = state.setProjectSelected;
    state.setProjectSelected = (pid, val) => { called = { pid, val }; };
    sidebar.toggleProject('p1');
    expect(called).to.deep.equal({ pid: 'p1', val: true });
    state.setProjectSelected = orig;
  });

  it('toggleTeam calls state.setTeamSelected with flipped value', () => {
    state._projectTeamService.initFromBaseline([], [{ id: 't1' }]);
    state.setTeamSelected('t1', true);
    // ensure sidebar's local teams list reflects the updated state
    if (sidebar && typeof sidebar._onTeamsChanged === 'function') sidebar._onTeamsChanged(state.teams);
    let called = null;
    const orig = state.setTeamSelected;
    state.setTeamSelected = (tid, val) => { called = { tid, val }; };
    sidebar.toggleTeam('t1');
    expect(called).to.deep.equal({ tid: 't1', val: false });
    state.setTeamSelected = orig;
  });

  it('renderScenarios produces markup containing scenario names and active marker', async () => {
    state._scenarioEventService._scenarios = [ { id: 's1', name: 'One' }, { id: 'baseline', name: 'Base' } ];
    state.activeScenarioId = 's1';
    // Emit events so components listening to ScenarioEvents update accordingly
    state._scenarioEventService.emitScenarioList();
    state._scenarioEventService.emitScenarioActivated();
    // call renderScenarios and render into temporary container
    const tpl = sidebar.renderScenarios();
    // Lit TemplateResult stringification is environment-specific; simply call requestUpdate to ensure DOM updated
    await sidebar.requestUpdate();
    const html = (sidebar.shadowRoot ? sidebar.shadowRoot.innerHTML : sidebar.innerHTML) || '';
    expect(html).to.include('One');
    // active scenario should include 'active' class
    expect(html).to.include('active');
  });
});
