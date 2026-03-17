import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import '../../www/js/components/DetailsPanel.lit.js';
import { state } from '../../www/js/services/State.js';

describe('DetailsPanel helper coverage', () => {
  beforeEach(async () => { await customElements.whenDefined('details-panel'); });

  it('_stripCapacityFromDescription removes planner block', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const desc = 'Intro\n[PlannerTool Team Capacity]\nteam data\n[/PlannerTool Team Capacity]\nMore';
    const cleaned = el._stripCapacityFromDescription(desc);
    expect(cleaned).to.not.contain('[PlannerTool Team Capacity]');
    expect(cleaned).to.contain('Intro');
    expect(cleaned).to.contain('More');
  });

  it('_stripIterationPrefix returns tail', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    expect(el._stripIterationPrefix('Project\\Iteration\\Sprint 1')).to.equal('Sprint 1');
    expect(el._stripIterationPrefix(null)).to.equal(null);
  });

  it('_saveCapacityEdit calls state.updateFeatureField and clears editing', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f1', capacity: [{ team: 't1', capacity: 20 }], original: {} };
    await el.updateComplete;
    const stub = sinon.stub(state, 'updateFeatureField');
    el._saveCapacityEdit('t1', '50');
    expect(stub.calledOnce).to.be.true;
    const args = stub.getCall(0).args;
    expect(args[0]).to.equal('f1');
    expect(args[1]).to.equal('capacity');
    stub.restore();
    expect(el.editingCapacityTeam).to.equal(null);
  });

  it('_handleAddTeamSubmit adds new team via state.updateFeatureField', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f2', capacity: [{ team: 't1', capacity: 20 }], original: {} };
    await el.updateComplete;
    const stub = sinon.stub(state, 'updateFeatureField');
    const form = document.createElement('form');
    const select = document.createElement('select'); select.innerHTML = '<option value="t2">T2</option>'; select.value = 't2';
    const input = document.createElement('input'); input.type = 'number'; input.value = '30';
    form.appendChild(select); form.appendChild(input);
    const ev = { target: form, preventDefault: () => {} };
    el._handleAddTeamSubmit(ev);
    expect(stub.calledOnce).to.be.true;
    const args = stub.getCall(0).args;
    expect(args[0]).to.equal('f2');
    expect(args[1]).to.equal('capacity');
    stub.restore();
  });

  it('capacity input value updates when switching features', async () => {
    // Stub state.teams getter to return test data
    const teamsStub = sinon.stub(state._projectTeamService, 'getTeams').returns([
      { id: 't1', name: 'Team Alpha', color: '#ff0000' },
      { id: 't2', name: 'Team Beta', color: '#00ff00' }
    ]);
    const projectsStub = sinon.stub(state, 'projects').get(() => [
      { id: 'p1', name: 'Project 1' }
    ]);

    const el = await fixture(html`<details-panel></details-panel>`);
    
    // First feature with t1 at 30%
    el.feature = { 
      id: 'f1', 
      title: 'Feature 1',
      project: 'p1',
      capacity: [{ team: 't1', capacity: 30 }], 
      original: {},
      orgLoad: '30%'
    };
    el.open = true;
    await el.updateComplete;

    // Get the input field for team t1
    const input1 = el.shadowRoot.querySelector('.capacity-bar-input');
    expect(input1).to.exist;
    expect(input1.value).to.equal('30');

    // Simulate user editing the value (but not submitting)
    input1.value = '45';
    input1.dispatchEvent(new Event('input'));
    await el.updateComplete;

    // Switch to second feature with t1 at 70%
    el.feature = { 
      id: 'f2', 
      title: 'Feature 2',
      project: 'p1',
      capacity: [{ team: 't1', capacity: 70 }], 
      original: {},
      orgLoad: '70%'
    };
    await el.updateComplete;

    // The input should now show 70, not the user's temporary 45
    const input2 = el.shadowRoot.querySelector('.capacity-bar-input');
    expect(input2).to.exist;
    expect(input2.value).to.equal('70');

    // Restore stubs
    teamsStub.restore();
    projectsStub.restore();
  });
});
