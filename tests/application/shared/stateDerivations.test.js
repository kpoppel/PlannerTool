import { describe, expect, it } from 'vitest';
import {
  deriveAvailableFeatureStates,
  deriveAvailableTaskTypes,
  deriveConfiguredStateSequence,
  deriveOrderedFeatureStateNames,
} from '../../../www/js/application/shared/stateDerivations.js';
import {
  taskTypeKey, displayTypes, typeStateCategory, isAdjacentTypeParent,
} from '../../../www/js/application/shared/workItemDisplay.js';
import { buildFoldModel } from '../../../www/js/components/hierarchyFold.js';

const display = [
  { process_id: 'first', process_name: 'First', tiers: [
    [{ name: 'Feature', states: [{ name: 'Open', category: 'Proposed' }] }],
    [{ name: 'Story', states: [{ name: 'Done', category: 'Completed' }] },
      { name: 'Bug', states: [{ name: 'Done', category: 'Completed' }] }],
  ] },
  { process_id: 'second', process_name: 'Second', tiers: [
    [{ name: 'Feature', states: [{ name: 'Open', category: 'InProgress' }] }],
  ] },
];

describe('normalized work item display', () => {
  it('keeps opaque process identity and process-first tier order', () => {
    expect(displayTypes(display).map((type) => type.key)).toEqual([
      taskTypeKey('first', 'Feature'), taskTypeKey('first', 'Story'),
      taskTypeKey('first', 'Bug'), taskTypeKey('second', 'Feature'),
    ]);
    expect(taskTypeKey('first', 'FEATURE')).toBe(taskTypeKey('first', 'Feature'));
    expect(taskTypeKey('first', 'Feature')).not.toBe(taskTypeKey('second', 'Feature'));
  });

  it('looks up state categories by process and type, not state name alone', () => {
    expect(typeStateCategory(display, { process_id: 'first', type: 'Feature', state: 'Open' }))
      .toBe('Proposed');
    expect(typeStateCategory(display, { process_id: 'second', type: 'Feature', state: 'Open' }))
      .toBe('InProgress');
  });

  it('relates adjacent tiers only, never siblings or unrelated processes', () => {
    const feature = { process_id: 'first', type: 'Feature' };
    const story = { process_id: 'first', type: 'Story' };
    const bug = { process_id: 'first', type: 'Bug' };
    expect(isAdjacentTypeParent(display, feature, story)).toBe(true);
    expect(isAdjacentTypeParent(display, feature, bug)).toBe(true);
    expect(isAdjacentTypeParent(display, story, bug)).toBe(false);
    expect(isAdjacentTypeParent(display, { ...feature, process_id: 'second' }, story)).toBe(false);
  });

  it('folds adjacent type tiers but never sibling or skipped-tier links', () => {
    const configured = [{ process_id: 'first', process_name: 'First', tiers: [
      [{ name: 'Epic', states: [] }], [{ name: 'Feature', states: [] }],
      [{ name: 'Story', states: [] }, { name: 'Bug', states: [] }],
    ] }];
    const features = [
      { id: 'root', process_id: 'first', type: 'Epic' },
      { id: 'feature', process_id: 'first', type: 'Feature', parentId: 'root' },
      { id: 'story', process_id: 'first', type: 'Story', parentId: 'feature' },
      { id: 'sibling', process_id: 'first', type: 'Bug', parentId: 'story' },
      { id: 'skip', process_id: 'first', type: 'Story', parentId: 'root' },
    ];
    const model = buildFoldModel(features, new Map(features.map((feature) => [feature.id, 'board'])),
      new Set(['root']), configured);
    expect(model.visible.map((feature) => feature.id)).toEqual(['root', 'sibling', 'skip']);
    expect(model.depth.get('story')).toBe(2);
    expect(model.depth.get('sibling')).toBe(0);
    expect(model.counts.get('root')).toBe(2);
  });
});

describe('application/shared/stateDerivations', () => {
  it('derives unique feature states in first-seen order', () => {
    const states = deriveAvailableFeatureStates([
      { id: 'f1', state: 'Doing' },
      { id: 'f2', state: 'Todo' },
      { id: 'f3', state: 'Doing' },
      { id: 'f4' },
    ]);

    expect(states).toEqual(['Doing', 'Todo']);
  });

  it('derives unique task types from canonical type field', () => {
    const types = deriveAvailableTaskTypes([
      { id: 'f1', type: 'Feature' },
      { id: 'f2', type: 'Epic' },
      { id: 'f3', type: 'Feature' },
      { id: 'f4' },
    ]);

    expect(types).toEqual([taskTypeKey(undefined, 'Feature'), taskTypeKey(undefined, 'Epic')]);
  });

  it('reads configured state sequence from normalized type display', () => {
    expect(deriveConfiguredStateSequence([{ work_item_display: display }]))
      .toEqual(['Open', 'Done']);
  });

  it('orders available states by configured sequence and appends remaining states', () => {
    const ordered = deriveOrderedFeatureStateNames(
      [
        {
          id: 'p1',
          work_item_display: [{ process_id: 'first', process_name: 'First', tiers: [[{
            name: 'Feature', states: ['New', 'Defined', 'Done'].map((name) =>
              ({ name, category: 'Proposed' })),
          }]] }],
        },
      ],
      [
        { id: 'f1', state: 'Done' },
        { id: 'f2', state: 'New' },
        { id: 'f3', state: 'Blocked' },
        { id: 'f4', state: 'Defined' },
      ]
    );

    expect(ordered).toEqual(['New', 'Defined', 'Done', 'Blocked']);
  });
});
