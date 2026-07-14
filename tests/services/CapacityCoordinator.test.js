import { expect } from '@esm-bundle/chai';

import { CapacityCoordinator } from '../../www/js/services/CapacityCoordinator.js';

function createCalculator() {
  return {
    children: null,
    calls: [],
    _emptyResult: () => ({ dates: [] }),
    setChildrenByParent(children) {
      this.children = children;
    },
    calculate(...args) {
      this.calls.push(args);
      return { dates: ['2025-01-01'] };
    },
  };
}

describe('CapacityCoordinator', () => {
  it('returns an empty result without invoking the calculator for empty required selections', () => {
    const calculator = createCalculator();
    const coordinator = new CapacityCoordinator(calculator);

    const outcome = coordinator.calculate({
      baselineTeams: [{ id: 't1' }],
      baselineProjects: [{ id: 'p1' }],
      requireTeamSelection: true,
    });

    expect(outcome).to.deep.equal({ result: { dates: [] }, calculated: false });
    expect(calculator.calls).to.deep.equal([]);
  });

  it('uses all working projects when graph selection filtering is disabled', () => {
    const calculator = createCalculator();
    const coordinator = new CapacityCoordinator(calculator);
    const children = new Map();

    const outcome = coordinator.calculate({
      features: [{ id: 'f1' }],
      baselineTeams: [{ id: 't1' }],
      baselineProjects: [{ id: 'p1' }, { id: 'p2' }],
      selectedProjectIds: ['p1'],
      allProjectIds: ['p1', 'p2'],
      selectedTeamIds: ['t1'],
      selectedStateIds: ['Active'],
      childrenByParent: children,
    });

    expect(outcome.calculated).to.equal(true);
    expect(calculator.children).to.equal(children);
    expect(calculator.calls[0][1]).to.deep.equal({
      selectedProjects: ['p1', 'p2'],
      selectedTeams: ['t1'],
      selectedStates: ['Active'],
    });
  });

  it('uses selected projects when graph selection filtering is enabled', () => {
    const calculator = createCalculator();
    const coordinator = new CapacityCoordinator(calculator);

    coordinator.calculate({
      features: [{ id: 'f1' }],
      baselineTeams: [{ id: 't1' }],
      baselineProjects: [{ id: 'p1' }, { id: 'p2' }],
      selectedProjectIds: ['p1'],
      allProjectIds: ['p1', 'p2'],
      selectedTeamIds: ['t1'],
      selectedStateIds: ['Active'],
      graphOnlySelected: true,
      requireProjectSelection: true,
    });

    expect(calculator.calls[0][1].selectedProjects).to.deep.equal(['p1']);
  });
});
