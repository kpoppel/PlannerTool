/**
 * Unit tests for PluginPlanHealthComponent orphan and hierarchy-violation checks.
 *
 * These tests stub the `state` singleton so the methods can run in isolation
 * without a full DOM / server environment.
 */
import { expect } from '@open-wc/testing';
import sinon from 'sinon';
import { state } from '../../www/js/services/State.js';

// Import the element class (does not mount it)
import { PluginPlanHealthComponent } from '../../www/js/plugins/PluginPlanHealthComponent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal feature factory */
function mkFeature(overrides) {
  return {
    id: `f${Math.random().toString(36).slice(2)}`,
    type: 'Feature',
    project: 'team-plan',
    parentId: null,
    ...overrides,
  };
}

function mkEpic(id, planId = 'team-plan', parentId = null) {
  return mkFeature({ id, type: 'Epic', project: planId, parentId });
}
function mkFeatureFn(id, planId = 'team-plan', parentId = null) {
  return mkFeature({ id, type: 'Feature', project: planId, parentId });
}
function mkStory(id, planId = 'team-plan', parentId = null) {
  return mkFeature({ id, type: 'User Story', project: planId, parentId });
}

/**
 * Standard hierarchy used by all tests:
 *   Level 0: Initiative
 *   Level 1: Epic
 *   Level 2: Feature
 *   Level 3: User Story, Bug
 */
const HIERARCHY = [
  { types: ['Initiative'] },
  { types: ['Epic'] },
  { types: ['Feature'] },
  { types: ['User Story', 'Bug'] },
];

function typeLevelFromHierarchy(type) {
  const key = String(type || '').toLowerCase();
  for (let i = 0; i < HIERARCHY.length; i++) {
    if (HIERARCHY[i].types.map((t) => t.toLowerCase()).includes(key)) return i;
  }
  return 9999;
}

function displayNameFromHierarchy(type) {
  const key = String(type || '').toLowerCase();
  for (const level of HIERARCHY) {
    const found = level.types.find((t) => t.toLowerCase() === key);
    if (found) return found;
  }
  return type;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
let comp;
let stateStubs = [];

function stubState(features, projects) {
  stateStubs.push(sinon.stub(state, 'getEffectiveFeatures').returns(features));
  stateStubs.push(sinon.stub(state, 'projects').get(() => projects));
  stateStubs.push(sinon.stub(state, 'taskTypeHierarchy').get(() => HIERARCHY));
  stateStubs.push(sinon.stub(state, 'getTypeLevel').callsFake(typeLevelFromHierarchy));
  stateStubs.push(
    sinon.stub(state, 'getTypeDisplayName').callsFake(displayNameFromHierarchy)
  );
}

beforeEach(() => {
  comp = new PluginPlanHealthComponent();
});

afterEach(() => {
  for (const s of stateStubs) s.restore();
  stateStubs = [];
});

// ---------------------------------------------------------------------------
// _checkOrphans
// ---------------------------------------------------------------------------

describe('PluginPlanHealthComponent._checkOrphans', () => {
  it('does NOT flag top-level type (Epic) as orphan even with no parent', () => {
    const epic = mkEpic('e1', 'team-plan', null);
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([epic], projects);

    const visibleIds = new Set(['e1']);
    const issues = comp._checkOrphans([epic], new Map(), visibleIds);
    expect(issues).to.have.lengthOf(0);
  });

  it('does NOT flag a Feature that has a valid Epic parent', () => {
    const epic = mkEpic('e1', 'team-plan', null);
    const feature = mkFeatureFn('f1', 'team-plan', 'e1');
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([epic, feature], projects);

    const visibleIds = new Set(['e1', 'f1']);
    const issues = comp._checkOrphans([epic, feature], new Map(), visibleIds);
    expect(issues).to.have.lengthOf(0);
  });

  it('does NOT flag a User Story that has a valid Feature parent', () => {
    const epic = mkEpic('e1', 'team-plan', null);
    const feature = mkFeatureFn('f1', 'team-plan', 'e1');
    const story = mkStory('s1', 'team-plan', 'f1');
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([epic, feature, story], projects);

    const visibleIds = new Set(['e1', 'f1', 's1']);
    const issues = comp._checkOrphans([epic, feature, story], new Map(), visibleIds);
    expect(issues).to.have.lengthOf(0);
  });

  it('flags a Feature with no parent as orphan (not top-level in plan)', () => {
    const epic = mkEpic('e1', 'team-plan', null);
    const feature = mkFeatureFn('f1', 'team-plan', null); // no parent
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([epic, feature], projects);

    const visibleIds = new Set(['e1', 'f1']);
    const issues = comp._checkOrphans([epic, feature], new Map(), visibleIds);
    expect(issues).to.have.lengthOf(1);
    expect(issues[0].featureId).to.equal('f1');
    expect(issues[0].type).to.equal('Orphan');
  });

  it('flags a User Story with no parent as orphan', () => {
    const epic = mkEpic('e1', 'team-plan', null);
    const story = mkStory('s1', 'team-plan', null); // no parent
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([epic, story], projects);

    const visibleIds = new Set(['e1', 's1']);
    const issues = comp._checkOrphans([epic, story], new Map(), visibleIds);
    expect(issues).to.have.lengthOf(1);
    expect(issues[0].featureId).to.equal('s1');
  });

  it('flags a Feature whose parentId points to a missing feature', () => {
    const epic = mkEpic('e1', 'team-plan', null);
    const feature = mkFeatureFn('f1', 'team-plan', 'e-missing');
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([epic, feature], projects); // e-missing not in state

    const visibleIds = new Set(['e1', 'f1']);
    const issues = comp._checkOrphans([epic, feature], new Map(), visibleIds);
    expect(issues).to.have.lengthOf(1);
    expect(issues[0].featureId).to.equal('f1');
    expect(issues[0].type).to.equal('Orphan');
  });

  it('does NOT flag a Feature whose parent is in another team plan (valid hierarchy)', () => {
    // Parent Epic is in a project-plan (old behaviour wrongly flagged this)
    const epic = mkEpic('e1', 'project-plan', null);
    const feature = mkFeatureFn('f1', 'team-plan', 'e1');
    const projects = [
      { id: 'team-plan', type: 'team' },
      { id: 'project-plan', type: 'project' },
    ];
    stubState([epic, feature], projects);

    const visibleIds = new Set(['e1', 'f1']);
    const issues = comp._checkOrphans([epic, feature], new Map(), visibleIds);
    expect(issues).to.have.lengthOf(0);
  });

  it('skips features not in visible set', () => {
    const epic = mkEpic('e1', 'team-plan', null);
    const feature = mkFeatureFn('f1', 'team-plan', null);
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([epic, feature], projects);

    const visibleIds = new Set(['e1']); // f1 not visible
    const issues = comp._checkOrphans([epic, feature], new Map(), visibleIds);
    expect(issues).to.have.lengthOf(0);
  });

  it('skips features not in team plans', () => {
    const feature = mkFeatureFn('f1', 'project-plan', null);
    const projects = [{ id: 'project-plan', type: 'project' }];
    stubState([feature], projects);

    const visibleIds = new Set(['f1']);
    const issues = comp._checkOrphans([feature], new Map(), visibleIds);
    expect(issues).to.have.lengthOf(0);
  });
});

// ---------------------------------------------------------------------------
// _checkHierarchyViolations
// ---------------------------------------------------------------------------

describe('PluginPlanHealthComponent._checkHierarchyViolations', () => {
  it('does not flag correct Epic → Feature parenting (Epic anchored to project plan)', () => {
    // Epic is anchored to a project-plan parent; Feature is parented by Epic.
    const projectEpic = mkEpic('pe1', 'project-plan', null); // project-plan anchor
    const epic = mkEpic('e1', 'team-plan', 'pe1');           // top-level in team plan
    const feature = mkFeatureFn('f1', 'team-plan', 'e1');
    const projects = [
      { id: 'team-plan', type: 'team' },
      { id: 'project-plan', type: 'project' },
    ];
    stubState([projectEpic, epic, feature], projects);

    const visibleIds = new Set(['pe1', 'e1', 'f1']);
    const issues = comp._checkHierarchyViolations([projectEpic, epic, feature], visibleIds);
    expect(issues).to.have.lengthOf(0);
  });

  it('does not flag correct Feature → User Story parenting (Feature anchored via Epic to project plan)', () => {
    const projectEpic = mkEpic('pe1', 'project-plan', null);
    const epic = mkEpic('e1', 'team-plan', 'pe1');     // anchored
    const feature = mkFeatureFn('f1', 'team-plan', 'e1');
    const story = mkStory('s1', 'team-plan', 'f1');
    const projects = [
      { id: 'team-plan', type: 'team' },
      { id: 'project-plan', type: 'project' },
    ];
    stubState([projectEpic, epic, feature, story], projects);

    const visibleIds = new Set(['pe1', 'e1', 'f1', 's1']);
    const issues = comp._checkHierarchyViolations([projectEpic, epic, feature, story], visibleIds);
    expect(issues).to.have.lengthOf(0);
  });

  it('flags Epic parented by another Epic (same-level parenting)', () => {
    // e1 is anchored to a project plan so it does not also fire an anchor issue.
    // e2 is parented by e1 which is at the same level → same-level violation.
    const projectEpic = mkEpic('pe1', 'project-plan', null);
    const parentEpic = mkEpic('e1', 'team-plan', 'pe1');  // anchored top-level
    const childEpic = mkEpic('e2', 'team-plan', 'e1');    // same-level
    const projects = [
      { id: 'team-plan', type: 'team' },
      { id: 'project-plan', type: 'project' },
    ];
    stubState([projectEpic, parentEpic, childEpic], projects);

    const visibleIds = new Set(['pe1', 'e1', 'e2']);
    const issues = comp._checkHierarchyViolations([projectEpic, parentEpic, childEpic], visibleIds);
    expect(issues).to.have.lengthOf(1);
    expect(issues[0].featureId).to.equal('e2');
    expect(issues[0].type).to.equal('HierarchyViolation');
    expect(issues[0].description).to.include('same hierarchy level');
  });

  it('flags User Story parented by User Story (same-level)', () => {
    // Both stories live in a team plan. The minimum hierarchy level is User Story,
    // so s1 is the top-level → also fires an anchor issue. s2 fires a same-level
    // issue. We just confirm s2's same-level issue is present.
    const parentStory = mkStory('s1', 'team-plan', null);
    const childStory = mkStory('s2', 'team-plan', 's1');
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([parentStory, childStory], projects);

    const visibleIds = new Set(['s1', 's2']);
    const issues = comp._checkHierarchyViolations([parentStory, childStory], visibleIds);
    const sameLevelIssue = issues.find(
      (i) => i.featureId === 's2' && i.description.includes('same hierarchy level')
    );
    expect(sameLevelIssue, 's2 same-level violation expected').to.exist;
  });

  it('flags Epic parented by Feature (reverse parenting)', () => {
    // Feature is the top-level type (lowest level number present) in team-plan, so
    // f1 firing an anchor issue too. e1 fires a reverse-parenting issue.
    // We confirm e1's reverse-parenting issue is present.
    const feature = mkFeatureFn('f1', 'team-plan', null);
    const epic = mkEpic('e1', 'team-plan', 'f1'); // Epic at level 1, Feature at level 2 → reverse
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([feature, epic], projects);

    const visibleIds = new Set(['f1', 'e1']);
    const issues = comp._checkHierarchyViolations([feature, epic], visibleIds);
    const reverseIssue = issues.find(
      (i) => i.featureId === 'e1' && i.description.includes('lower hierarchy level')
    );
    expect(reverseIssue, 'e1 reverse-parenting issue expected').to.exist;
  });

  it('flags top-level team-plan Epic with no parent (not anchored to a project plan)', () => {
    // An Epic is the top-level type in this team plan and has no parentId at all.
    // This should be flagged as a hierarchy violation because the team plan is not
    // anchored to any project plan.
    const epic = mkEpic('e1', 'team-plan', null);
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([epic], projects);

    const visibleIds = new Set(['e1']);
    const issues = comp._checkHierarchyViolations([epic], visibleIds);
    expect(issues).to.have.lengthOf(1);
    expect(issues[0].featureId).to.equal('e1');
    expect(issues[0].type).to.equal('HierarchyViolation');
    expect(issues[0].description).to.include('project plan');
  });

  it('skips top-level team-plan Epic that is properly anchored to a project plan', () => {
    const projectEpic = mkEpic('pe1', 'project-plan', null); // parent in project plan
    const teamEpic = mkEpic('e1', 'team-plan', 'pe1');
    const projects = [
      { id: 'team-plan', type: 'team' },
      { id: 'project-plan', type: 'project' },
    ];
    stubState([projectEpic, teamEpic], projects);

    const visibleIds = new Set(['pe1', 'e1']);
    const issues = comp._checkHierarchyViolations([projectEpic, teamEpic], visibleIds);
    expect(issues).to.have.lengthOf(0);
  });

  it('flags top-level team-plan Epic whose parent is in another team plan (not a project plan)', () => {
    // e1 is the top-level Epic in team-plan. Its parent e0 is also an Epic but in
    // another team plan — this is a same-level parenting violation (Check B), not
    // an anchor issue. The root cause check (anchor) fires on e0 itself.
    const otherTeamEpic = mkEpic('e0', 'other-team-plan', null);
    const teamEpic = mkEpic('e1', 'team-plan', 'e0'); // parent also in a team plan
    const projects = [
      { id: 'team-plan', type: 'team' },
      { id: 'other-team-plan', type: 'team' },
    ];
    stubState([otherTeamEpic, teamEpic], projects);

    const visibleIds = new Set(['e0', 'e1']);
    const issues = comp._checkHierarchyViolations([otherTeamEpic, teamEpic], visibleIds);
    // e1's parent is an Epic → same-level violation is raised
    const e1Issue = issues.find((i) => i.featureId === 'e1');
    expect(e1Issue, 'e1 should have a hierarchy issue').to.exist;
    expect(e1Issue.type).to.equal('HierarchyViolation');
    // e0 (top-level with no valid project-plan parent) fires the anchor issue
    const e0Issue = issues.find((i) => i.featureId === 'e0');
    expect(e0Issue, 'e0 should be flagged as unanchored').to.exist;
    expect(e0Issue.description).to.include('project plan');
  });

  it('flags top-level team-plan Epic whose parentId points to a missing feature', () => {
    const teamEpic = mkEpic('e1', 'team-plan', 'missing-id');
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([teamEpic], projects);

    const visibleIds = new Set(['e1']);
    const issues = comp._checkHierarchyViolations([teamEpic], visibleIds);
    expect(issues).to.have.lengthOf(1);
    expect(issues[0].featureId).to.equal('e1');
    expect(issues[0].type).to.equal('HierarchyViolation');
  });

  it('skips non-top-level items with no parentId (handled by orphan check)', () => {
    // A Feature (level 2) with no parent in a team plan where Epics are at level 1
    // (so Feature is NOT the top-level type here). That is an orphan, not a hierarchy
    // violation, so _checkHierarchyViolations should not flag it.
    const epic = mkEpic('e1', 'team-plan', null);
    const feature = mkFeatureFn('f1', 'team-plan', null); // no parent, not top-level
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([epic, feature], projects);

    const visibleIds = new Set(['e1', 'f1']);
    const issues = comp._checkHierarchyViolations([epic, feature], visibleIds);
    // Only e1 (top-level, no project parent) should be flagged;
    // f1 has no parent but is not top-level — handled by orphan check.
    expect(issues.every((i) => i.featureId !== 'f1')).to.be.true;
  });

  it('skips items not in visible set', () => {
    const parentEpic = mkEpic('e1', 'project-plan', null); // anchored
    const childEpic = mkEpic('e2', 'team-plan', 'e1'); // same-level violation but not visible
    const projects = [
      { id: 'team-plan', type: 'team' },
      { id: 'project-plan', type: 'project' },
    ];
    stubState([parentEpic, childEpic], projects);

    const visibleIds = new Set(['e1']); // e2 not visible
    const issues = comp._checkHierarchyViolations([parentEpic, childEpic], visibleIds);
    expect(issues).to.have.lengthOf(0);
  });

  it('skips non-top-level items whose parent cannot be found (handled by orphan check)', () => {
    // f1 is a Feature in a team plan that also has Epics (so Feature is NOT top-level).
    // f1 has a missing parent → orphan check handles it; hierarchy check should not flag it.
    const epic = mkEpic('e1', 'team-plan', null); // top-level, fires anchor issue
    const feature = mkFeatureFn('f1', 'team-plan', 'missing-parent');
    const projects = [{ id: 'team-plan', type: 'team' }];
    stubState([epic, feature], projects);

    const visibleIds = new Set(['e1', 'f1']);
    const issues = comp._checkHierarchyViolations([epic, feature], visibleIds);
    // f1 should NOT appear in hierarchy issues (it's handled by orphan check)
    expect(issues.every((i) => i.featureId !== 'f1')).to.be.true;
  });

  it('skips check when no hierarchy is configured', () => {
    const parentEpic = mkEpic('e1', 'team-plan', null);
    const childEpic = mkEpic('e2', 'team-plan', 'e1');
    const projects = [{ id: 'team-plan', type: 'team' }];
    // Override taskTypeHierarchy stub to return empty
    stubState([parentEpic, childEpic], projects);
    // Replace the hierarchy stub with empty
    stateStubs[stateStubs.length - 3].restore(); // taskTypeHierarchy is 3rd from end
    stateStubs.push(sinon.stub(state, 'taskTypeHierarchy').get(() => []));

    const visibleIds = new Set(['e1', 'e2']);
    const issues = comp._checkHierarchyViolations([parentEpic, childEpic], visibleIds);
    expect(issues).to.have.lengthOf(0);
  });
});
