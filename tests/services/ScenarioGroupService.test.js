import { expect } from '@esm-bundle/chai';

import { EventBus } from '../../www/js/core/EventBus.js';
import { GroupEvents } from '../../www/js/core/EventRegistry.js';
import { ScenarioGroupService } from '../../www/js/services/ScenarioGroupService.js';

function createHarness(scenario = null) {
  const bus = new EventBus();
  const events = [];
  const unsubscribe = bus.on(GroupEvents.CHANGED, (event) => events.push(event));
  let changed = 0;
  const service = new ScenarioGroupService({
    bus,
    getActiveScenario: () => scenario,
    getActiveWritableScenario: () => (scenario?.readonly ? null : scenario),
    markChanged: () => {
      changed += 1;
      scenario.isChanged = true;
    },
    now: () => 100,
    random: () => 0.5,
  });

  return {
    service,
    events,
    get changed() {
      return changed;
    },
    dispose: unsubscribe,
  };
}

describe('ScenarioGroupService', () => {
  it('creates, updates, and reports a local scenario group', () => {
    const scenario = { id: 's1', scenarioGroups: [], groupOverrides: {} };
    const harness = createHarness(scenario);

    try {
      const created = harness.service.create('p1', 'Local', '#fff');
      const updated = harness.service.update(created.id, { name: 'Renamed' });

      expect(created).to.include({
        id: 'tmp_100_i',
        plan_id: 'p1',
        name: 'Local',
        rank: 100,
        color: '#fff',
      });
      expect(updated.name).to.equal('Renamed');
      expect(harness.service.getPendingChanges()).to.deep.equal([
        { type: 'create', group: scenario.scenarioGroups[0] },
      ]);
      expect(harness.events.map((event) => event.op)).to.deep.equal(['created', 'updated']);
      expect(harness.changed).to.equal(2);
    } finally {
      harness.dispose();
    }
  });

  it('records baseline overrides and last-write-wins member deltas', () => {
    const scenario = { id: 's1', scenarioGroups: [], groupOverrides: {} };
    const harness = createHarness(scenario);

    try {
      harness.service.update('baseline-1', { name: 'Override' });
      harness.service.applyMemberDelta('baseline-1', 'task-1', 'add');
      harness.service.applyMemberDelta('baseline-1', 'task-1', 'remove');

      expect(scenario.groupOverrides['baseline-1']).to.deep.equal({
        name: 'Override',
        memberDeltas: [{ taskId: 'task-1', op: 'remove' }],
      });
      expect(harness.service.getPendingChanges()).to.deep.equal([
        {
          type: 'update',
          groupId: 'baseline-1',
          fields: { name: 'Override' },
          memberDeltas: [{ taskId: 'task-1', op: 'remove' }],
        },
      ]);
    } finally {
      harness.dispose();
    }
  });

  it('cascades local deletes and marks baseline groups deleted', () => {
    const scenario = {
      id: 's1',
      scenarioGroups: [
        { id: 'tmp-parent', plan_id: 'p1', name: 'Parent' },
        { id: 'tmp-child', plan_id: 'p1', name: 'Child', parent_id: 'tmp-parent' },
      ],
      groupOverrides: {},
    };
    const harness = createHarness(scenario);

    try {
      harness.service.delete('tmp-parent');
      harness.service.delete('baseline-1');

      expect(scenario.scenarioGroups).to.deep.equal([]);
      expect(scenario.groupOverrides['baseline-1']).to.deep.equal({ _deleted: true });
      expect(harness.events.map((event) => event.op)).to.deep.equal(['deleted', 'deleted']);
    } finally {
      harness.dispose();
    }
  });

  it('does not mutate readonly scenarios', () => {
    const scenario = { id: 'baseline', readonly: true, scenarioGroups: [], groupOverrides: {} };
    const harness = createHarness(scenario);

    try {
      expect(harness.service.create('p1', 'Blocked')).to.equal(null);
      harness.service.applyMemberDelta('baseline-1', 'task-1', 'add');
      expect(scenario).to.deep.equal({
        id: 'baseline',
        readonly: true,
        scenarioGroups: [],
        groupOverrides: {},
      });
      expect(harness.events).to.deep.equal([]);
    } finally {
      harness.dispose();
    }
  });
});
