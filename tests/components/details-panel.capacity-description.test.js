import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import '../../www/js/components/DetailsPanel.lit.js';
import { cmd, sel } from '../../www/js/application/imports.js';
import { render as renderTemplate } from '../../www/js/vendor/lit.js';
import {
  buildDetailsPanelCapacityModel,
  renderDetailsPanelCapacity,
} from '../../www/js/components/details-panel/DetailsPanelCapacity.lit.js';
import {
  buildDetailsPanelRelationsModel,
  renderDetailsPanelRelations,
} from '../../www/js/components/details-panel/DetailsPanelRelations.lit.js';
import { renderDetailsPanelTags } from '../../www/js/components/details-panel/DetailsPanelTags.lit.js';
import { renderDetailsPanelHeader } from '../../www/js/components/details-panel/DetailsPanelHeader.lit.js';

describe('DetailsPanel header and tag section actions', () => {
  it('dispatches tag draft values, additions, and removals without private host methods', async () => {
    const actions = { changeDraft: sinon.spy(), addTag: sinon.spy(), removeTag: sinon.spy() };
    const model = { tags: ['one'], changed: true, originalTags: 'before', newTagText: '' };
    const root = await fixture(html`<div>${renderDetailsPanelTags({ model, actions })}</div>`);
    const input = root.querySelector('.tag-input');
    input.value = 'two';
    input.dispatchEvent(new Event('input'));
    expect(actions.changeDraft.calledOnceWithExactly('two')).to.be.true;
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).to.be.true;
    expect(actions.addTag.calledOnce).to.be.true;
    root.querySelector('.tag-chip button').click();
    expect(actions.removeTag.calledOnceWithExactly('one')).to.be.true;
    expect(root.textContent).to.include('(was before)');
  });

  it('dispatches header close and state selection through explicit actions', async () => {
    const actions = { close: sinon.spy(), startStateEdit: sinon.spy(), blurState: sinon.spy(), selectState: sinon.spy() };
    const model = {
      feature: { id: 'f1', title: 'Item', type: 'Task', state: 'New', url: 'https://example.test/1' },
      planName: 'Plan', stateChanged: true, originalState: 'Before',
      stateColors: { New: { background: '#ffffff', text: '#000000' } },
      availableFeatureStates: ['New', 'Done'], editingState: true, stateEditValue: 'New',
    };
    const root = await fixture(html`<div></div>`);
    renderTemplate(renderDetailsPanelHeader({ model, actions }), root);
    root.querySelector('.details-close').click();
    expect(actions.close.calledOnce).to.be.true;
    root.querySelectorAll('.state-choices button')[1].click();
    expect(actions.selectState.calledOnceWithExactly('Done')).to.be.true;
    expect(root.textContent).to.include('(was Before)');
  });
});

describe('DetailsPanel relations section contract', () => {
  function buildModel(relations) {
    return buildDetailsPanelRelationsModel({
      relations,
      projectId: 'p1',
      featureUrl: 'https://example.test/workitems/100',
      projects: [{ id: 'p1', name: 'Current' }, { id: 'p2', name: 'Other plan' }],
      linkedFeatures: new Map([
        ['1', { id: '1', project: 'p2', title: 'Parent item', type: 'Epic', state: 'New' }],
        ['2', { id: '2', project: 'p1', title: 'Completed child', type: 'Task', state: 'Done' }],
        ['3', { id: '3', project: 'p1', title: 'New child', type: 'Task', state: 'New' }],
      ]),
      stateColors: { New: { background: '#ffffff' }, Done: { background: '#00ff00' } },
      stateCategories: new Map([['New', 'Proposed'], ['Done', 'Completed']]),
    });
  }

  it('orders parents first and loaded children by category without changing source relations', () => {
    const relations = Object.freeze([
      Object.freeze({ id: '99', type: 'Child', url: '' }),
      Object.freeze({ id: '2', type: 'Child', url: '' }),
      Object.freeze({ id: '1', type: 'Parent', url: '' }),
      Object.freeze({ id: '3', type: 'Child', url: '' }),
    ]);
    const model = buildModel(relations);
    expect(model.groups.map((group) => group.title)).to.deep.equal([
      'Parent (in Other plan)', 'Child',
    ]);
    expect(model.groups[1].items.map((item) => item.id)).to.deep.equal(['3', '2', '99']);
    expect(relations.map((relation) => relation.id)).to.deep.equal(['99', '2', '1', '3']);
  });

  it('renders explicit links and unloaded child labels from the model alone', async () => {
    const model = buildModel([
      { id: '99', type: 'Child', url: '' },
      { id: '2', type: 'Child', url: 'https://other.test/task/2' },
    ]);
    const actions = { centerFeature: sinon.spy() };
    const root = await fixture(html`<div></div>`);
    renderTemplate(renderDetailsPanelRelations({ model, actions }), root);
    const links = root.querySelectorAll('.details-link');
    expect(links[0].getAttribute('href')).to.equal('https://other.test/task/2');
    expect(links[1].getAttribute('href')).to.equal('https://example.test/workitems/99');
    expect(links[1].textContent).to.include('(task state not loaded)');
    expect(root.querySelector('.relation-state-indicator').getAttribute('title')).to.equal('Done');
  });

  it('dispatches the related feature ID when its icon is clicked', async () => {
    const model = buildModel([{ id: '2', type: 'Child', url: '' }]);
    const actions = { centerFeature: sinon.spy() };
    const root = await fixture(html`<div></div>`);
    renderTemplate(renderDetailsPanelRelations({ model, actions }), root);

    root.querySelector('.relation-icon').click();

    expect(actions.centerFeature.calledOnceWithExactly('2')).to.be.true;
  });

  it('preserves original ordering for children in the same category', () => {
    const model = buildModel([
      { id: '3', type: 'Child', url: '' },
      { id: '3', type: 'Child', url: '' },
      { id: '98', type: 'Child', url: '' },
      { id: '99', type: 'Child', url: '' },
    ]);
    expect(model.groups[0].items.map((item) => item.id)).to.deep.equal(['3', '3', '98', '99']);
  });

  it('renders the existing empty-state presentation for no relations', async () => {
    const model = buildModel([]);
    const root = await fixture(html`<div>${renderDetailsPanelRelations({ model })}</div>`);
    expect(root.querySelectorAll('.relations-group')).to.have.length(0);
    expect(root.textContent).to.include('Links:');
    expect(root.textContent).to.include('—');
  });
});

describe('DetailsPanel capacity section contract', () => {
  const teams = [
    { id: 't1', name: 'Alpha', color: '#ff0000' },
    { id: 't2', name: 'Beta', color: '#00ff00' },
    { id: 't3', name: 'Gamma', color: '#0000ff' },
  ];

  function createActions() {
    return {
      changeCapacity: sinon.spy(),
      removeTeam: sinon.spy(),
      toggleAddTeam: sinon.spy(),
      addTeam: sinon.spy(),
      cancelAddTeam: sinon.spy(),
      cancelEdit: sinon.spy(),
    };
  }

  it('projects allocation rows and scaled summary without mutating inputs', () => {
    const capacity = Object.freeze([
      Object.freeze({ team: 't1', capacity: 80 }),
      Object.freeze({ team: 't2', capacity: 70 }),
    ]);
    const model = buildDetailsPanelCapacityModel({
      capacity, orgLoad: '150%', teams, showAddTeamPopover: false,
    });

    expect(model.rows.map((row) => [row.teamId, row.name, row.capacity])).to.deep.equal([
      ['t1', 'Alpha', 80], ['t2', 'Beta', 70],
    ]);
    expect(model.availableTeams.map((team) => team.id)).to.deep.equal(['t3']);
    expect(model.summary.teamCount).to.equal(2);
    expect(model.summary.segments[0].width).to.be.closeTo(80 / 150 * 100, 0.001);
    expect(model.summary.segments[1].width).to.be.closeTo(70 / 150 * 100, 0.001);
    expect(capacity[0].capacity).to.equal(80);
  });

  it('keeps unresolved allocations in totals but renders only known teams', () => {
    const model = buildDetailsPanelCapacityModel({
      capacity: [{ team: 'missing', capacity: 40 }, { team: 't1', capacity: 20 }],
      orgLoad: '60%', teams, showAddTeamPopover: false,
    });
    expect(model.rows.map((row) => row.teamId)).to.deep.equal(['t1']);
    expect(model.summary.teamCount).to.equal(2);
    expect(model.summary.segments[0].width).to.equal(20);
  });

  it('renders and dispatches edits without a panel host or application state', async () => {
    const model = buildDetailsPanelCapacityModel({
      capacity: [{ team: 't1', capacity: 40 }],
      orgLoad: '40%', teams, showAddTeamPopover: false,
    });
    const actions = createActions();
    const root = await fixture(html`<div>${renderDetailsPanelCapacity({ model, actions })}</div>`);
    const input = root.querySelector('.capacity-bar-input');
    input.value = '70';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(actions.changeCapacity.calledOnceWithExactly('t1', '70')).to.be.true;
    root.querySelector('.capacity-bar-delete').click();
    expect(actions.removeTeam.calledOnceWithExactly('t1')).to.be.true;
    root.querySelector('.add-team-btn').click();
    expect(actions.toggleAddTeam.calledOnce).to.be.true;
  });

  it('submits only the selected team and input value to the add action', async () => {
    const model = buildDetailsPanelCapacityModel({
      capacity: [{ team: 't1', capacity: 40 }],
      orgLoad: '40%', teams, showAddTeamPopover: true,
    });
    const actions = createActions();
    const root = await fixture(html`<div>${renderDetailsPanelCapacity({ model, actions })}</div>`);
    const form = root.querySelector('.add-team-form');
    form.querySelector('select').value = 't2';
    form.querySelector('input').value = '30';
    const event = new Event('submit', { cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).to.be.true;
    expect(actions.addTeam.calledOnceWithExactly('t2', '30')).to.be.true;
    expect(root.querySelector('.add-team-form select').options).to.have.length(3);
  });
});

describe('DetailsPanel behavior', () => {
  beforeEach(async () => {
    await customElements.whenDefined('details-panel');
  });

  it('_stripCapacityFromDescription removes planner block', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    const desc =
      'Intro\n[PlannerTool Team Capacity]\nteam data\n[/PlannerTool Team Capacity]\nMore';
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

  it('_saveCapacityEdit calls cmd.feature.updateFeatureField and clears editing', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = {
      id: 'f1',
      capacity: [{ team: 't1', capacity: 20 }],
      original: {},
    };
    await el.updateComplete;
    const stub = sinon.stub(cmd.feature, 'updateFeatureField');
    el._saveCapacityEdit('t1', '50');
    expect(stub.calledOnce).to.be.true;
    const args = stub.getCall(0).args;
    expect(args[0]).to.equal('f1');
    expect(args[1]).to.equal('capacity');
    stub.restore();
    expect(el.editingCapacityTeam).to.equal(null);
  });

  it('_handleAddTeamSubmit adds new team via cmd.feature.updateFeatureField', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = {
      id: 'f2',
      capacity: [{ team: 't1', capacity: 20 }],
      original: {},
    };
    await el.updateComplete;
    const stub = sinon.stub(cmd.feature, 'updateFeatureField');
    const form = document.createElement('form');
    const select = document.createElement('select');
    select.innerHTML = '<option value="t2">T2</option>';
    select.value = 't2';
    const input = document.createElement('input');
    input.type = 'number';
    input.value = '30';
    form.appendChild(select);
    form.appendChild(input);
    const ev = { target: form, preventDefault: () => {} };
    el._handleAddTeamSubmit(ev);
    expect(stub.calledOnce).to.be.true;
    const args = stub.getCall(0).args;
    expect(args[0]).to.equal('f2');
    expect(args[1]).to.equal('capacity');
    stub.restore();
  });

  it('capacity input value updates when switching features', async () => {
    const getTeamsStub = sinon.stub(sel.selection, 'getTeams').returns([
      { id: 't1', name: 'Team Alpha', color: '#ff0000' },
      { id: 't2', name: 'Team Beta', color: '#00ff00' },
    ]);
    const getProjectsStub = sinon.stub(sel.selection, 'getProjects').returns([
      { id: 'p1', name: 'Project 1' },
    ]);

    const el = await fixture(html`<details-panel></details-panel>`);

    // First feature with t1 at 30%
    el.feature = {
      id: 'f1',
      title: 'Feature 1',
      project: 'p1',
      capacity: [{ team: 't1', capacity: 30 }],
      original: {},
      orgLoad: '30%',
      relations: [],
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
      orgLoad: '70%',
      relations: [],
    };
    await el.updateComplete;

    // The input should now show 70, not the user's temporary 45
    const input2 = el.shadowRoot.querySelector('.capacity-bar-input');
    expect(input2).to.exist;
    expect(input2.value).to.equal('70');

    // Restore stubs
    getTeamsStub.restore();
    getProjectsStub.restore();
  });
});
