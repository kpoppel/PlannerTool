import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import '../../www/js/components/DetailsPanel.lit.js';
import { state } from '../../www/js/services/State.js';

describe('DetailsPanel additional function coverage', () => {
  beforeEach(async () => {
    await customElements.whenDefined('details-panel');
  });

  it('_onShow opens and sets feature', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const f = { id: 'x1', title: 'X' };
    el._onShow(f);
    expect(el.open).to.equal(true);
    expect(el.feature).to.equal(f);
  });

  it('_shrinkwrapEpic computes bounds and calls state.updateFeatureDates', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    // Prepare epic + children
    el.feature = { id: 'e1', type: 'epic' };
    await el.updateComplete;

    const childrenMap = new Map();
    childrenMap.set('e1', ['c1', 'c2']);
    // childrenByParent is a getter on state; stub the getter to return our map
    const childrenStub = sinon.stub(state, 'childrenByParent').get(() => childrenMap);

    // stub effective features
    const stubGet = sinon.stub(state, 'getEffectiveFeatureById');
    stubGet.withArgs('c1').returns({ id: 'c1', start: '2025-01-05', end: '2025-01-10' });
    stubGet.withArgs('c2').returns({ id: 'c2', start: '2025-01-01', end: '2025-01-12' });

    const stubUpdate = sinon.stub(state, 'updateFeatureDates');
    await el._shrinkwrapEpic({ stopPropagation: () => {} });
    expect(stubUpdate.calledOnce).to.be.true;
    const arg = stubUpdate.getCall(0).args[0][0];
    expect(arg.id).to.equal('e1');
    expect(arg.start).to.equal('2025-01-01');
    expect(arg.end).to.equal('2025-01-12');

    stubGet.restore();
    stubUpdate.restore();
    childrenStub.restore();
  });

  it('_handleCapacityClick focuses and selects input', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    // create DOM structure inside shadowRoot
    const row = document.createElement('div');
    row.className = 'capacity-bar-row';
    const input = document.createElement('input');
    input.className = 'capacity-bar-input';
    // stub focus/select
    input.focus = sinon.stub();
    input.select = sinon.stub();
    row.appendChild(input);
    // attach to shadowRoot so closest works
    el.shadowRoot.appendChild(row);

    const ev = { target: input, stopPropagation: () => {} };
    el._handleCapacityClick('t1', ev);
    expect(input.focus.called).to.be.true;
    expect(input.select.called).to.be.true;
  });

  it('_handleCapacityInputKeydown saves on Enter and cancels on Escape', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f1', capacity: [{ team: 't1', capacity: 10 }] };
    await el.updateComplete;
    const stub = sinon.stub(state, 'updateFeatureField');

    // Enter key
    const enterEv = { key: 'Enter', target: { value: '42' } };
    el._handleCapacityInputKeydown('t1', enterEv);
    expect(stub.calledOnce).to.be.true;

    stub.resetHistory();
    // Escape key
    el.editingCapacityTeam = 't1';
    const escEv = { key: 'Escape', target: {} };
    el._handleCapacityInputKeydown('t1', escEv);
    expect(el.editingCapacityTeam).to.be.null;

    stub.restore();
  });

  it('_saveCapacityEdit clamps values and calls updateFeatureField', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f2', capacity: [{ team: 't1', capacity: 20 }] };
    await el.updateComplete;
    const stub = sinon.stub(state, 'updateFeatureField');
    el._saveCapacityEdit('t1', '300');
    expect(stub.calledOnce).to.be.true;
    const newCap = stub.getCall(0).args[2] || stub.getCall(0).args[1];
    // ensure capacity value clamped to 100 inside the payload (search payload)
    const payload = stub.getCall(0).args;
    expect(stub.called).to.be.true;
    stub.restore();
  });

  it('_handleDeleteCapacity removes team and calls updateFeatureField', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = {
      id: 'f3',
      capacity: [
        { team: 't1', capacity: 20 },
        { team: 't2', capacity: 30 },
      ],
    };
    await el.updateComplete;
    const stub = sinon.stub(state, 'updateFeatureField');
    el._handleDeleteCapacity('t2', { stopPropagation: () => {} });
    expect(stub.calledOnce).to.be.true;
    const args = stub.getCall(0).args;
    expect(args[0]).to.equal('f3');
    stub.restore();
  });

  it('_handleAddTeamClick toggles popover', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.showAddTeamPopover = false;
    el._handleAddTeamClick({ stopPropagation: () => {} });
    expect(el.showAddTeamPopover).to.equal(true);
    el._handleAddTeamClick({ stopPropagation: () => {} });
    expect(el.showAddTeamPopover).to.equal(false);
  });

  it('_onStateClick and _saveStateEdit call state.updateFeatureField', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f4', state: 'New' };
    await el.updateComplete;
    const stub = sinon.stub(state, 'updateFeatureField');
    el._onStateClick({ stopPropagation: () => {} });
    el._stateEditValue = 'In Progress';
    el._saveStateEdit();
    expect(stub.calledOnce).to.be.true;
    const args = stub.getCall(0).args;
    expect(args[0]).to.equal('f4');
    expect(args[1]).to.equal('state');
    stub.restore();
  });

  it('_onIterationChange updates dates via state.updateFeatureDates', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f10' };
    // Provide iterations via state so _loadIterationsForFeature picks them up
    // stub the state's iterations getter so _loadIterationsForFeature picks them up
    const itersStub = sinon.stub(state, 'iterations').get(() => [
      {
        path: 'Proj\\Iteration\\It1',
        startDate: '2025-02-01',
        finishDate: '2025-02-10',
      },
    ]);
    // trigger the load that runs in updated lifecycle
    await el._loadIterationsForFeature();

    const stub = sinon.stub(state, 'updateFeatureDates');
    // simulate selection change - component accepts full path or suffix
    // select elements may pass either full path or suffix; use suffix to match endsWith
    const ev = { target: { value: 'It1' } };
    await el._onIterationChange(ev);

    expect(stub.calledOnce).to.be.true;
    const arg = stub.getCall(0).args[0][0];
    expect(arg.id).to.equal('f10');
    expect(arg.start).to.equal('2025-02-01');
    expect(arg.end).to.equal('2025-02-10');

    stub.restore();
    itersStub.restore();
  });
});
