import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import '../../www/js/components/DetailsPanel.lit.js';
import {
  buildDetailsPanelSchedulingModel,
  getDetailsPanelChildDateBounds,
  renderDetailsPanelScheduling,
} from '../../www/js/components/details-panel/DetailsPanelScheduling.lit.js';
import { cmd, sel } from '../../www/js/application/imports.js';
import { bus } from '../../www/js/core/EventBus.js';
import { FeatureEvents, ProjectEvents } from '../../www/js/core/EventRegistry.js';
import { store } from '../../www/js/application/store.js';

describe('DetailsPanel editing and scheduling commands', () => {
  it('applies a generic date preset by exact opaque id without changing native fields', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'preset-task' };
    await el.updateComplete;
    el.schedulePresets = [
      { id: 'opaque-1', label: 'Sprint', start: '2026-10-01', end: '2026-10-14' },
    ];
    const dates = sinon.stub(cmd.feature, 'updateFeatureDates');
    const fields = sinon.stub(cmd.feature, 'updateFeatureField');
    await el._onSchedulePresetChange('opaque-1');
    expect(dates.calledOnceWithExactly([
      { id: 'preset-task', start: '2026-10-01', end: '2026-10-14' },
    ])).to.be.true;
    expect(fields.called).to.be.false;
    dates.resetHistory();
    await el._onSchedulePresetChange('1');
    expect(dates.called).to.be.false;
  });

  let initialStoreState;
  beforeEach(async () => {
    initialStoreState = store.getState();
    await customElements.whenDefined('details-panel');
  });

  afterEach(() => {
    sinon.restore();
    store.setState(initialStoreState, true);
  });

  it('invalidates pending status edits and drafts when another feature is selected', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const first = { id: 'first', state: 'New', capacity: [], orgLoad: '0%', relations: [] };
    const selected = sinon.stub(sel.feature, 'getSelectedFeature').returns(first);
    const update = sinon.stub(cmd.feature, 'updateFeatureField');
    el._onShow();
    await el.updateComplete;
    const clock = sinon.useFakeTimers();
    el._onStateClick();
    el._stateEditValue = 'Done';
    el._onStateBlur();
    el._newTagText = 'unfinished';
    el.showAddTeamPopover = true;
    el.editingCapacityTeam = 't1';
    selected.returns({ ...first, id: 'second' });
    el._onShow();
    await el.updateComplete;
    clock.tick(200);
    expect(update.called).to.be.false;
    expect(el.editingState).to.be.false;
    expect(el._stateEditValue).to.equal(null);
    expect(el._newTagText).to.equal('');
    expect(el.showAddTeamPopover).to.be.false;
    expect(el.editingCapacityTeam).to.equal(null);
  });

  it('cancels pending status commits on close and disconnection', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const feature = { id: 'first', state: 'New', capacity: [], orgLoad: '0%', relations: [] };
    sinon.stub(sel.feature, 'getSelectedFeature').returns(feature);
    const update = sinon.stub(cmd.feature, 'updateFeatureField');
    el._onShow();
    await el.updateComplete;
    const clock = sinon.useFakeTimers();
    el._onStateClick();
    el._stateEditValue = 'Done';
    el._onStateBlur();
    el.hide();
    clock.tick(200);
    expect(update.called).to.be.false;
    el._onShow();
    await el.updateComplete;
    el._onStateClick();
    el._stateEditValue = 'Done';
    el._onStateBlur();
    el.remove();
    clock.tick(200);
    expect(update.called).to.be.false;
  });

  it('refreshes once after reconnect and not at all while disconnected', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const feature = { id: 'first', state: 'New', capacity: [], orgLoad: '0%', relations: [] };
    el.feature = feature;
    el.open = true;
    await el.updateComplete;
    const projectRefresh = sinon.stub(el, '_loadSchedulePresetsForFeature').resolves();
    const parent = el.parentNode;
    el.remove();
    bus.emit(ProjectEvents.CHANGED);
    expect(projectRefresh.called).to.be.false;
    parent.appendChild(el);
    await el.updateComplete;
    projectRefresh.resetHistory();
    bus.emit(ProjectEvents.CHANGED);
    expect(projectRefresh.calledOnce).to.be.true;
  });

  it('invalidates pending edits when switching scenarios on the same feature', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const feature = { id: 'first', state: 'New', capacity: [], orgLoad: '0%', relations: [] };
    el.feature = feature;
    el.open = true;
    await el.updateComplete;
    const update = sinon.stub(cmd.feature, 'updateFeatureField');
    sinon.stub(sel.feature, 'getEffectiveFeatureById').returns({ ...feature, state: 'Active' });
    const clock = sinon.useFakeTimers();
    el._onStateClick();
    el._stateEditValue = 'Done';
    el._onStateBlur();
    store.setState((state) => ({
      ...state, scenarios: {
        ...state.scenarios, activeId: 'another-scenario',
        items: [...state.scenarios.items, { ...state.scenarios.items[0], id: 'another-scenario' }],
      },
    }));
    clock.tick(200);
    await el.updateComplete;
    expect(update.called).to.be.false;
    expect(el.feature.state).to.equal('Active');
    expect(el.editingState).to.be.false;
  });

  it('ignores an allocation blur from a previously rendered feature', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    sinon.stub(sel.selection, 'getTeams').returns([{ id: 't1', name: 'Team', color: '#ffffff' }]);
    const feature = { id: 'first', state: 'New', capacity: [{ team: 't1', capacity: 20 }],
      orgLoad: '20%', relations: [] };
    el.feature = feature;
    el.open = true;
    await el.updateComplete;
    const input = el.shadowRoot.querySelector('.capacity-bar-input');
    const update = sinon.stub(cmd.feature, 'updateFeatureField');
    input.value = '80';
    el.feature = { ...feature, id: 'second' };
    input.dispatchEvent(new Event('blur'));
    expect(update.called).to.be.false;
    await el.updateComplete;
  });

  it('converts man-day edits, preserves unchanged rounded displays and ignores stale unit drafts', async () => {
    store.setState((state) => ({ ...state, allocation: { unit: 'man-days', staffing: {
      status: 'ready', fteById: { t1: 5 }, generation: 1, error: null,
    } } }));
    const el = await fixture(html`<details-panel></details-panel>`);
    sinon.stub(sel.selection, 'getTeams').returns([{ id: 't1', name: 'Team', color: '#ffffff' }]);
    el.feature = { id: 'first', state: 'New', start: '2026-10-05', end: '2026-10-16',
      capacity: [{ team: 't1', capacity: 20 }], orgLoad: '20%', relations: [] };
    el.open = true;
    await el.updateComplete;
    const update = sinon.stub(cmd.feature, 'updateFeatureField');
    const input = el.shadowRoot.querySelector('.capacity-bar-input');
    expect(input.value).to.equal('10');
    input.dispatchEvent(new Event('blur'));
    expect(update.called).to.be.false;
    input.value = '15';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    input.dispatchEvent(new Event('blur'));
    expect(update.calledOnceWithExactly('first', 'capacity', [{ team: 't1', capacity: 30 }])).to.be.true;
    await el.updateComplete;
    const stale = el.shadowRoot.querySelector('.capacity-bar-input');
    update.resetHistory();
    store.setState((state) => ({ ...state, allocation: { ...state.allocation, unit: 'percent' } }));
    stale.value = '40';
    stale.dispatchEvent(new Event('blur'));
    expect(update.called).to.be.false;
    await el.updateComplete;
  });

  it('validates direct man-day input and converts new team allocations without clamping', async () => {
    store.setState((state) => ({ ...state, allocation: { unit: 'man-days', staffing: {
      status: 'ready', fteById: { t1: 5 }, generation: 1, error: null,
    } } }));
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'first', state: 'New', start: '2026-10-05', end: '2026-10-16',
      capacity: [], orgLoad: '0%', relations: [] };
    el.open = true;
    await el.updateComplete;
    const update = sinon.stub(cmd.feature, 'updateFeatureField');
    const notify = sinon.stub(cmd.ui, 'addNotification');
    el._addCapacityTeam('t1', '51');
    el._addCapacityTeam('t1', '');
    el._addCapacityTeam('t1', '10.1');
    expect(update.called).to.be.false;
    expect(notify.called).to.be.true;
    el._addCapacityTeam('t1', '10');
    expect(update.calledOnceWithExactly('first', 'capacity', [{ team: 't1', capacity: 20 }])).to.be.true;
  });

  it('preserves fractional percentages from whole man-day entry without rounding notices', async () => {
    store.setState((state) => ({ ...state, allocation: { unit: 'man-days', staffing: {
      status: 'ready', fteById: { t1: 6 }, generation: 1, error: null,
    } } }));
    const el = await fixture(html`<details-panel></details-panel>`);
    sinon.stub(sel.selection, 'getTeams').returns([{ id: 't1', name: 'Team', color: '#ffffff' }]);
    const feature = { id: 'first', state: 'New', start: '2026-10-05', end: '2026-10-16',
      capacity: [{ team: 't1', capacity: 20 }], orgLoad: '20%', relations: [] };
    el.feature = feature;
    el.open = true;
    await el.updateComplete;
    const update = sinon.stub(cmd.feature, 'updateFeatureField');
    const notify = sinon.stub(cmd.ui, 'addNotification');
    const input = el.shadowRoot.querySelector('.capacity-bar-input');
    input.value = '11';
    input.dispatchEvent(new Event('blur'));
    await el.updateComplete;
    expect(input.value).to.equal('11');
    expect(update.calledOnce).to.be.true;
    expect(update.firstCall.args[2][0].capacity).to.be.closeTo(11 / 60 * 100, 1e-12);
    expect(notify.called).to.be.false;
  });

  it('computes child date bounds independently, ignoring absent and invalid dates', () => {
    const children = Object.freeze([
      Object.freeze({ start: '2026-10-02', end: '2026-10-04' }),
      Object.freeze({ start: '2026-10-01', end: 'invalid' }),
      Object.freeze({ start: null, end: '2026-10-06' }),
      null,
    ]);
    expect(getDetailsPanelChildDateBounds(children)).to.deep.equal({
      start: '2026-10-01', end: '2026-10-06',
    });
    expect(getDetailsPanelChildDateBounds([])).to.deep.equal({ start: null, end: null });
  });

  it('groups current and future iterations separately from past iterations', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const model = buildDetailsPanelSchedulingModel({
      feature: { id: 'x1' },
      presets: [
        { id: 'current', label: 'Current', start: '2026-01-01', end: today },
        { id: 'past', label: 'Past', start: '2019-12-01', end: '2020-01-01' },
      ],
      childrenByParent: new Map(),
      orig: {},
      today,
    });
    const rendered = renderDetailsPanelScheduling({ model, actions: {} });
    const root = await fixture(html`<div>${rendered}</div>`);

    expect([...root.querySelectorAll('optgroup')].map((group) => group.label)).to.deep.equal([
      'Current and future',
      'Past',
    ]);
    expect([...root.querySelectorAll('option')].map((option) => option.textContent.trim())).to.deep.equal([
      '—',
      `Current (2026-01-01 to ${today})`,
      'Past (2019-12-01 to 2020-01-01)',
    ]);
  });

  it('dispatches scheduling values through explicit actions without a host', async () => {
    const model = buildDetailsPanelSchedulingModel({
      feature: { id: 'parent', type: 'Epic', start: '2026-10-01', end: '2026-10-10' },
      presets: [{ id: 'preset-1', label: 'Sprint', start: '2026-10-01', end: '2026-10-10' }],
      childrenByParent: new Map([['parent', ['child']]]), orig: {}, today: '2026-10-02',
    });
    const actions = {
      selectPreset: sinon.spy(), changeStart: sinon.spy(), changeEnd: sinon.spy(),
      snapStart: sinon.spy(), snapEnd: sinon.spy(), fitChildren: sinon.spy(), clearDates: sinon.spy(),
    };
    const root = await fixture(html`<div>${renderDetailsPanelScheduling({ model, actions })}</div>`);
    const select = root.querySelector('.iteration-select');
    select.value = 'preset-1';
    select.dispatchEvent(new Event('change'));
    expect(actions.selectPreset.calledOnceWithExactly('preset-1')).to.be.true;
    const start = root.querySelector('input[type="date"]');
    start.value = '2026-10-03';
    start.dispatchEvent(new Event('change'));
    expect(actions.changeStart.calledOnceWithExactly('2026-10-03')).to.be.true;
    root.querySelector('[data-test="shrinkwrap-chip"]').click();
    expect(actions.fitChildren.calledOnce).to.be.true;
    root.querySelector('.clear-dates-btn').click();
    expect(actions.clearDates.calledOnce).to.be.true;
  });

  it('_onShow opens and sets feature', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const f = { id: 'x1', title: 'X', capacity: [], orgLoad: '0%', relations: [] };
    const stub = sinon.stub(sel.feature, 'getSelectedFeature').returns(f);
    el._onShow();
    stub.restore();
    expect(el.open).to.equal(true);
    expect(el.feature).to.equal(f);
  });

  it('_shrinkwrapEpic computes bounds and calls cmd.feature.updateFeatureDates', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    // Prepare epic + children
    el.feature = { id: 'e1', type: 'epic' };
    await el.updateComplete;

    const childrenMap = new Map([['e1', ['c1', 'c2']]]);
    const childrenStub = sinon.stub(sel.feature, 'getChildrenByParentMap').returns(childrenMap);

    const stubGet = sinon.stub(sel.feature, 'getEffectiveFeatureById');
    stubGet.withArgs('c1').returns({ id: 'c1', start: '2025-01-05', end: '2025-01-10' });
    stubGet.withArgs('c2').returns({ id: 'c2', start: '2025-01-01', end: '2025-01-12' });

    const stubUpdate = sinon.stub(cmd.feature, 'updateFeatureDates');
    await el._shrinkwrapEpic({ stopPropagation: () => {} });
    expect(stubUpdate.calledOnce).to.be.true;
    const arg = stubUpdate.getCall(0).args[0][0];
    expect(arg.id).to.equal('e1');
    expect(arg.start).to.equal('2025-01-01');
    expect(arg.end).to.equal('2025-01-12');
    expect(arg.shiftChildren).to.equal(false);

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
    const stub = sinon.stub(cmd.feature, 'updateFeatureField');

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

  it('clamps capacity to 100 without changing baseline allocations', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const baseline = [{ team: 't1', capacity: 20 }, { team: 't2', capacity: 30 }];
    el.feature = { id: 'f2', capacity: baseline };
    await el.updateComplete;
    const stub = sinon.stub(cmd.feature, 'updateFeatureField');
    el._saveCapacityEdit('t1', '300');
    expect(stub.calledOnceWithExactly('f2', 'capacity', [
      { team: 't1', capacity: 100 }, { team: 't2', capacity: 30 },
    ])).to.be.true;
    expect(baseline).to.deep.equal([
      { team: 't1', capacity: 20 }, { team: 't2', capacity: 30 },
    ]);
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
    const stub = sinon.stub(cmd.feature, 'updateFeatureField');
    el._handleDeleteCapacity('t2', { stopPropagation: () => {} });
    expect(stub.calledOnceWithExactly('f3', 'capacity', [
      { team: 't1', capacity: 20 },
    ])).to.be.true;
    expect(el.feature.capacity).to.have.length(2);
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

  it('_onStateClick and _saveStateEdit call cmd.feature.updateFeatureField', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f4', state: 'New' };
    await el.updateComplete;
    const stub = sinon.stub(cmd.feature, 'updateFeatureField');
    el._onStateClick({ stopPropagation: () => {} });
    el._stateEditValue = 'In Progress';
    el._saveStateEdit();
    expect(stub.calledOnce).to.be.true;
    const args = stub.getCall(0).args;
    expect(args[0]).to.equal('f4');
    expect(args[1]).to.equal('state');
    stub.restore();
  });

  it('_addTag adds a new tag via cmd.feature.updateFeatureField', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f-tags-1', tags: 'one; two' };
    el._newTagText = 'three';
    await el.updateComplete;

    const stub = sinon.stub(cmd.feature, 'updateFeatureField');
    el._addTag();

    expect(stub.calledOnce).to.be.true;
    expect(stub.getCall(0).args).to.deep.equal(['f-tags-1', 'tags', 'one; two; three']);
    expect(el._newTagText).to.equal('');
    stub.restore();
  });

  it('_removeTag clears tags when removing the last tag', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f-tags-2', tags: 'solo' };
    await el.updateComplete;

    const stub = sinon.stub(cmd.feature, 'updateFeatureField');
    el._removeTag('solo');

    expect(stub.calledOnce).to.be.true;
    expect(stub.getCall(0).args).to.deep.equal(['f-tags-2', 'tags', null]);
    stub.restore();
  });

  it('_onSchedulePresetChange updates dates via cmd.feature.updateFeatureDates', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f10' };
    const getIterationsStub = sinon.stub(sel.feature, 'getSchedulePresetsForProject').returns([
      {
        id: 'preset-1', label: 'It1',
        start: '2025-02-01',
        end: '2025-02-10',
      },
    ]);
    // trigger the load that runs in updated lifecycle
    await el._loadSchedulePresetsForFeature();

    const datesStub = sinon.stub(cmd.feature, 'updateFeatureDates');
    const fieldStub = sinon.stub(cmd.feature, 'updateFeatureField');
    await el._onSchedulePresetChange('preset-1');

    expect(fieldStub.called).to.be.false;
    expect(datesStub.calledOnce).to.be.true;
    const arg = datesStub.getCall(0).args[0][0];
    expect(arg.id).to.equal('f10');
    expect(arg.start).to.equal('2025-02-01');
    expect(arg.end).to.equal('2025-02-10');

    getIterationsStub.restore();
    datesStub.restore();
    fieldStub.restore();
  });

  it('reloads iterations when projects change while panel is open', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.open = true;
    el.feature = {
      id: 'f-proj-refresh', project: 'project-a', capacity: [], orgLoad: '0%', relations: [],
    };
    await el.updateComplete;

    const reloadStub = sinon.stub(el, '_loadSchedulePresetsForFeature').resolves();
    bus.emit(ProjectEvents.CHANGED, [{ id: 'project-a', name: 'Project A' }]);
    await new Promise((r) => setTimeout(r, 0));

    expect(reloadStub.called).to.be.true;
    reloadStub.restore();
  });

  it('reloads displayed feature and iterations on global FeatureEvents.UPDATED', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const displayed = {
      id: 'f-global-refresh', project: 'project-a', capacity: [], orgLoad: '0%', relations: [],
    };
    const refreshed = { ...displayed, state: 'Done' };

    el.open = true;
    el.feature = displayed;
    await el.updateComplete;

    const getStub = sinon.stub(sel.feature, 'getEffectiveFeatureById').returns(refreshed);
    const reloadStub = sinon.stub(el, '_loadSchedulePresetsForFeature').resolves();

    bus.emit(FeatureEvents.UPDATED);
    await new Promise((r) => setTimeout(r, 0));

    expect(getStub.calledOnceWithExactly('f-global-refresh')).to.be.true;
    expect(el.feature).to.equal(refreshed);
    expect(reloadStub.called).to.be.true;

    getStub.restore();
    reloadStub.restore();
  });

  it('_onStartDateChange calls cmd.feature.updateFeatureDates with new start', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f20', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;
    const stub = sinon.stub(cmd.feature, 'updateFeatureDates');

    el._onStartDateChange('2025-01-15');

    expect(stub.calledOnce).to.be.true;
    const arg = stub.getCall(0).args[0][0];
    expect(arg.id).to.equal('f20');
    expect(arg.start).to.equal('2025-01-15');
    expect(arg.end).to.equal('2025-02-01');
    stub.restore();
  });

  it('_onEndDateChange calls cmd.feature.updateFeatureDates with new end', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f21', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;
    const stub = sinon.stub(cmd.feature, 'updateFeatureDates');

    el._onEndDateChange('2025-03-01');

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
    const stub = sinon.stub(cmd.feature, 'updateFeatureDates');

    el._onStartDateChange('');

    expect(stub.calledOnce).to.be.true;
    const arg = stub.getCall(0).args[0][0];
    expect(arg.start).to.equal(null);
    stub.restore();
  });

  it('_clearDates calls cmd.feature.updateFeatureDates with null dates', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f23', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;
    const stub = sinon.stub(cmd.feature, 'updateFeatureDates');

    el._clearDates();

    expect(stub.calledOnce).to.be.true;
    const arg = stub.getCall(0).args[0][0];
    expect(arg.id).to.equal('f23');
    expect(arg.start).to.equal(null);
    expect(arg.end).to.equal(null);
    stub.restore();
  });

  it('_clearDates only emits generic date changes even when native metadata exists', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f24', start: '2025-01-01', end: '2025-02-01', iterationPath: 'Team\\Sprint 3' };
    await el.updateComplete;
    const fieldStub = sinon.stub(cmd.feature, 'updateFeatureField');
    const datesStub = sinon.stub(cmd.feature, 'updateFeatureDates');

    el._clearDates();

    expect(fieldStub.called).to.be.false;
    expect(datesStub.calledOnce).to.be.true;
    expect(datesStub.getCall(0).args[0][0]).to.deep.include({ id: 'f24', start: null, end: null });
    fieldStub.restore();
    datesStub.restore();
  });

  it('_clearDates does not call updateFeatureField when no iterationPath is set', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f25', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;
    const fieldStub = sinon.stub(cmd.feature, 'updateFeatureField');
    const datesStub = sinon.stub(cmd.feature, 'updateFeatureDates');

    el._clearDates();

    expect(fieldStub.called).to.be.false;
    expect(datesStub.calledOnce).to.be.true;
    fieldStub.restore();
    datesStub.restore();
  });

  it('_clearDates does nothing when no feature is set', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const stub = sinon.stub(cmd.feature, 'updateFeatureDates');

    el._clearDates();

    expect(stub.called).to.be.false;
    stub.restore();
  });

  it('_snapStartDate snaps start to earliest child, keeps current end', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'ep1', type: 'epic', start: '2025-01-01', end: '2025-03-01' };
    await el.updateComplete;

    const childrenMap = new Map([['ep1', ['c1', 'c2']]]);
    const childrenStub = sinon.stub(sel.feature, 'getChildrenByParentMap').returns(childrenMap);
    const getStub = sinon.stub(sel.feature, 'getEffectiveFeatureById');
    getStub.withArgs('c1').returns({ id: 'c1', start: '2025-02-01', end: '2025-02-15' });
    getStub.withArgs('c2').returns({ id: 'c2', start: '2025-01-10', end: '2025-02-20' });
    const updateStub = sinon.stub(cmd.feature, 'updateFeatureDates');

    el._snapStartDate({ stopPropagation: () => {} });

    expect(updateStub.calledOnce).to.be.true;
    const arg = updateStub.getCall(0).args[0][0];
    expect(arg.id).to.equal('ep1');
    expect(arg.start).to.equal('2025-01-10');
    expect(arg.end).to.equal('2025-03-01'); // unchanged
    expect(arg.shiftChildren).to.equal(false);

    childrenStub.restore();
    getStub.restore();
    updateStub.restore();
  });

  it('_snapEndDate snaps end to latest child, keeps current start', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'ep2', type: 'epic', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;

    const childrenMap = new Map([['ep2', ['c3', 'c4']]]);
    const childrenStub = sinon.stub(sel.feature, 'getChildrenByParentMap').returns(childrenMap);
    const getStub = sinon.stub(sel.feature, 'getEffectiveFeatureById');
    getStub.withArgs('c3').returns({ id: 'c3', start: '2025-01-05', end: '2025-02-10' });
    getStub.withArgs('c4').returns({ id: 'c4', start: '2025-01-08', end: '2025-03-15' });
    const updateStub = sinon.stub(cmd.feature, 'updateFeatureDates');

    el._snapEndDate({ stopPropagation: () => {} });

    expect(updateStub.calledOnce).to.be.true;
    const arg = updateStub.getCall(0).args[0][0];
    expect(arg.id).to.equal('ep2');
    expect(arg.start).to.equal('2025-01-01'); // unchanged
    expect(arg.end).to.equal('2025-03-15');
    expect(arg.shiftChildren).to.equal(false);

    childrenStub.restore();
    getStub.restore();
    updateStub.restore();
  });

  it('_snapStartDate does nothing when feature has no children', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: 'f30', start: '2025-01-01', end: '2025-02-01' };
    await el.updateComplete;

    const childrenStub = sinon.stub(sel.feature, 'getChildrenByParentMap').returns(new Map());
    const updateStub = sinon.stub(cmd.feature, 'updateFeatureDates');

    el._snapStartDate({ stopPropagation: () => {} });

    expect(updateStub.called).to.be.false;

    childrenStub.restore();
    updateStub.restore();
  });

  it('selects a preset only when the date range matches exactly', () => {
    const feature = { start: '2025-04-01', end: '2025-04-30' };
    const presets = [
      { id: 'preset-1', label: 'March', start: '2025-03-01', end: '2025-03-31' },
      { id: 'preset-2', label: 'April', start: '2025-04-01', end: '2025-04-30' },
    ];
    const model = buildDetailsPanelSchedulingModel({
      feature, presets, childrenByParent: new Map(), orig: {}, today: '2025-04-01',
    });
    expect(model.selectedPresetId).to.equal('preset-2');
  });

  it('does not select a preset after manual date edits', () => {
    const feature = { start: '2025-04-05', end: '2025-04-28' };
    const presets = [
      { id: 'preset-2', label: 'April', start: '2025-04-01', end: '2025-04-30' },
    ];
    const model = buildDetailsPanelSchedulingModel({
      feature, presets, childrenByParent: new Map(), orig: {}, today: '2025-04-01',
    });
    expect(model.selectedPresetId).to.equal('');
  });

  it('does not claim a preset when multiple presets have identical dates', () => {
    const model = buildDetailsPanelSchedulingModel({
      feature: { start: '2025-04-01', end: '2025-04-30' },
      presets: ['one', 'two'].map((id) => ({
        id, label: id, start: '2025-04-01', end: '2025-04-30',
      })), childrenByParent: new Map(), orig: {}, today: '2025-04-01',
    });
    expect(model.selectedPresetId).to.equal('');
  });
});
