import { expect } from '@esm-bundle/chai';

import {
  selectAvailableTaskTypes,
  selectOrderedTaskTypes,
  selectTaskTypeDisplayName,
  selectTaskTypeHierarchy,
  selectTaskTypeLevel,
} from '../../www/js/application/selectors/taskTypeSelectors.js';

const hierarchy = [
  { types: ['Epic'] },
  { types: ['Feature', 'Capability'] },
  { types: ['User Story'] },
];

describe('task type selectors', () => {
  it('derives sorted distinct task types from canonical and legacy fields', () => {
    const types = selectAvailableTaskTypes([
      { type: 'Feature' },
      { workItemType: 'Epic' },
      { work_item_type: 'User Story' },
      { type: 'Feature' },
      {},
    ]);

    expect(types).to.deep.equal(['Epic', 'Feature', 'User Story']);
  });

  it('selects the first configured task hierarchy in project order', () => {
    const selected = selectTaskTypeHierarchy([
      { id: 'p1', task_type_hierarchy: [] },
      { id: 'p2', task_type_hierarchy: hierarchy },
      { id: 'p3', task_type_hierarchy: [{ types: ['Ignored'] }] },
    ]);

    expect(selected).to.equal(hierarchy);
    expect(selectTaskTypeHierarchy([])).to.deep.equal([]);
  });

  it('finds levels and configured display spelling case-insensitively', () => {
    expect(selectTaskTypeLevel(hierarchy, 'feature')).to.equal(1);
    expect(selectTaskTypeLevel(hierarchy, 'unconfigured')).to.equal(9999);
    expect(selectTaskTypeDisplayName(hierarchy, 'user story')).to.equal('User Story');
    expect(selectTaskTypeDisplayName(hierarchy, 'Task')).to.equal('Task');
  });

  it('orders configured types by hierarchy and unconfigured types alphabetically', () => {
    const ordered = selectOrderedTaskTypes(
      ['task', 'feature', 'Epic', 'bug', 'user story'],
      hierarchy
    );

    expect(ordered).to.deep.equal(['Epic', 'Feature', 'User Story', 'bug', 'task']);
  });

  it('keeps the original type order when no hierarchy is configured', () => {
    const types = ['Feature', 'Epic'];
    expect(selectOrderedTaskTypes(types, [])).to.equal(types);
  });
});
