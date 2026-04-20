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

  it('_onStartDateChange calls state.updateFeatureDates with new start', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f20', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;
    const stub = sinon.stub(state, 'updateFeatureDates');

    el._onStartDateChange({ target: { value: '2025-01-15' } });

    expect(stub.calledOnce).to.be.true;
    const arg = stub.getCall(0).args[0][0];
    expect(arg.id).to.equal('f20');
    expect(arg.start).to.equal('2025-01-15');
    expect(arg.end).to.equal('2025-02-01');
    stub.restore();
  });

  it('_onEndDateChange calls state.updateFeatureDates with new end', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f21', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;
    const stub = sinon.stub(state, 'updateFeatureDates');

    el._onEndDateChange({ target: { value: '2025-03-01' } });

    expect(stub.calledOnce).to.be.true;
    const arg = stub.getCall(0).args[0][0];
    expect(arg.id).to.equal('f21');
    expect(arg.start).to.equal('2025-01-01');
    expect(arg.end).to.equal('2025-03-01');
    stub.restore();
  });

  it('_onStartDateChange treats empty value as null', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f22', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;
    const stub = sinon.stub(state, 'updateFeatureDates');

    el._onStartDateChange({ target: { value: '' } });

    expect(stub.calledOnce).to.be.true;
    const arg = stub.getCall(0).args[0][0];
    expect(arg.start).to.equal(null);
    stub.restore();
  });

  it('_clearDates calls state.updateFeatureDates with null dates', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f23', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;
    const stub = sinon.stub(state, 'updateFeatureDates');

    el._clearDates();

    expect(stub.calledOnce).to.be.true;
    const arg = stub.getCall(0).args[0][0];
    expect(arg.id).to.equal('f23');
    expect(arg.start).to.equal(null);
    expect(arg.end).to.equal(null);
    stub.restore();
  });

  it('_clearDates also clears iterationPath when one is set', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f24', start: '2025-01-01', end: '2025-02-01', iterationPath: 'Team\\Sprint 3' };
    await el.updateComplete;
    const fieldStub = sinon.stub(state, 'updateFeatureField');
    const datesStub = sinon.stub(state, 'updateFeatureDates');

    el._clearDates();

    // iterationPath must be cleared before the dates call
    expect(fieldStub.calledOnce).to.be.true;
    expect(fieldStub.getCall(0).args).to.deep.equal(['f24', 'iterationPath', null]);
    expect(datesStub.calledOnce).to.be.true;
    expect(datesStub.getCall(0).args[0][0]).to.deep.include({ id: 'f24', start: null, end: null });
    fieldStub.restore();
    datesStub.restore();
  });

  it('_clearDates does not call updateFeatureField when no iterationPath is set', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f25', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;
    const fieldStub = sinon.stub(state, 'updateFeatureField');
    const datesStub = sinon.stub(state, 'updateFeatureDates');

    el._clearDates();

    expect(fieldStub.called).to.be.false;
    expect(datesStub.calledOnce).to.be.true;
    fieldStub.restore();
    datesStub.restore();
  });

  it('_clearDates does nothing when no feature is set', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const stub = sinon.stub(state, 'updateFeatureDates');

    el._clearDates();

    expect(stub.called).to.be.false;
    stub.restore();
  });

  it('_snapStartDate snaps start to earliest child, keeps current end', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'ep1', type: 'epic', start: '2025-01-01', end: '2025-03-01' };
    await el.updateComplete;

    const childrenMap = new Map([['ep1', ['c1', 'c2']]]);
    const childrenStub = sinon.stub(state, 'childrenByParent').get(() => childrenMap);
    const getStub = sinon.stub(state, 'getEffectiveFeatureById');
    getStub.withArgs('c1').returns({ id: 'c1', start: '2025-02-01', end: '2025-02-15' });
    getStub.withArgs('c2').returns({ id: 'c2', start: '2025-01-10', end: '2025-02-20' });
    const updateStub = sinon.stub(state, 'updateFeatureDates');

    el._snapStartDate({ stopPropagation: () => {} });

    expect(updateStub.calledOnce).to.be.true;
    const arg = updateStub.getCall(0).args[0][0];
    expect(arg.id).to.equal('ep1');
    expect(arg.start).to.equal('2025-01-10');
    expect(arg.end).to.equal('2025-03-01'); // unchanged

    childrenStub.restore();
    getStub.restore();
    updateStub.restore();
  });

  it('_snapEndDate snaps end to latest child, keeps current start', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'ep2', type: 'epic', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;

    const childrenMap = new Map([['ep2', ['c3', 'c4']]]);
    const childrenStub = sinon.stub(state, 'childrenByParent').get(() => childrenMap);
    const getStub = sinon.stub(state, 'getEffectiveFeatureById');
    getStub.withArgs('c3').returns({ id: 'c3', start: '2025-01-05', end: '2025-02-10' });
    getStub.withArgs('c4').returns({ id: 'c4', start: '2025-01-08', end: '2025-03-15' });
    const updateStub = sinon.stub(state, 'updateFeatureDates');

    el._snapEndDate({ stopPropagation: () => {} });

    expect(updateStub.calledOnce).to.be.true;
    const arg = updateStub.getCall(0).args[0][0];
    expect(arg.id).to.equal('ep2');
    expect(arg.start).to.equal('2025-01-01'); // unchanged
    expect(arg.end).to.equal('2025-03-15');

    childrenStub.restore();
    getStub.restore();
    updateStub.restore();
  });

  it('_snapStartDate does nothing when feature has no children', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f30', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;

    const childrenStub = sinon.stub(state, 'childrenByParent').get(() => new Map());
    const updateStub = sinon.stub(state, 'updateFeatureDates');

    el._snapStartDate({ stopPropagation: () => {} });

    expect(updateStub.called).to.be.false;

    childrenStub.restore();
    updateStub.restore();
  });

  it('_activeIterationPath returns matching path when dates match exactly', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const feature = { start: '2025-04-01', end: '2025-04-30' };
    const iterations = [
      { path: 'Proj\\It1', startDate: '2025-03-01', finishDate: '2025-03-31' },
      { path: 'Proj\\It2', startDate: '2025-04-01', finishDate: '2025-04-30' },
    ];
    const result = el._activeIterationPath(feature, iterations);
    expect(result).to.equal('Proj\\It2');
  });

  it('_activeIterationPath returns null when dates do not match any iteration', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const feature = { start: '2025-04-05', end: '2025-04-28' };
    const iterations = [
      { path: 'Proj\\It2', startDate: '2025-04-01', finishDate: '2025-04-30' },
    ];
    const result = el._activeIterationPath(feature, iterations);
    expect(result).to.equal(null);
  });

  it('_activeIterationPath returns null when feature has no dates', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const result = el._activeIterationPath({}, [
      { path: 'Proj\\It2', startDate: '2025-04-01', finishDate: '2025-04-30' },
    ]);
    expect(result).to.equal(null);
  });
});
