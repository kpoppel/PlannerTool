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
});
