import { describe, expect, it } from 'vitest';
import {
  assignFeatureToSwimlane,
  buildSwimlaneList,
  isSwimlaneMode,
} from '../www/js/services/SwimlaneService.js';

const mkProject = (id, selected, color = '#aaa') => ({ id, name: id, color, selected });
const mkFeature = (id, project, parentId = null) => ({ id, project, parentId, capacity: [] });

describe('SwimlaneService', () => {
  const projects = [mkProject('p1', true), mkProject('p2', false), mkProject('p3', false)];
  const noContext = { parent: false, child: false, dependency: false, otherAllocations: false };

  it('does not activate without selected plans or Context source-plan lanes', () => {
    expect(isSwimlaneMode([mkProject('p1', false)], [])).toBe(false);
  });

  it('activates for multiple selected plans or contextual source-plan lanes', () => {
    expect(isSwimlaneMode([mkProject('p1', true), mkProject('p2', true)], [])).toBe(true);
    expect(isSwimlaneMode(projects, [
      { id: 'p1', type: 'plan' },
      { id: 'p2', type: 'expanded-plan' },
    ])).toBe(true);
  });

  it('creates lanes only for selected plans while Context is off', () => {
    const lanes = buildSwimlaneList(projects, [mkFeature('f1', 'p1'), mkFeature('f2', 'p2')], noContext);
    expect(lanes).toEqual([{ id: 'p1', name: 'p1', color: '#aaa', type: 'plan' }]);
  });

  it('orders selected ancestor plan lanes before their selected descendants', () => {
    const features = [mkFeature('parent', 'p1'), mkFeature('child', 'p2', 'parent')];
    const lanes = buildSwimlaneList(
      [mkProject('p2', true), mkProject('p1', true)], features, noContext
    );

    expect(lanes.map((lane) => lane.id)).toEqual(['p1', 'p2']);
  });

  it('adds visible cross-plan lanes when Parent or Child Context is enabled', () => {
    const visible = [mkFeature('f1', 'p1'), mkFeature('f2', 'p2')];
    expect(buildSwimlaneList(projects, visible, { ...noContext, parent: true })[1])
      .toMatchObject({ id: 'p2', type: 'expanded-plan' });
    expect(buildSwimlaneList(projects, visible, { ...noContext, child: true })[1])
      .toMatchObject({ id: 'p2', type: 'expanded-plan' });
  });

  it('adds an Other allocation source-plan lane without creating team lanes', () => {
    const lanes = buildSwimlaneList(
      projects,
      [mkFeature('base', 'p1'), mkFeature('other', 'p3')],
      { ...noContext, otherAllocations: true }
    );

    expect(lanes).toEqual([
      { id: 'p1', name: 'p1', color: '#aaa', type: 'plan' },
      { id: 'p3', name: 'p3', color: '#aaa', type: 'expanded-plan' },
    ]);
  });

  it('keeps selected-plan work in its own lane', () => {
    const lanes = [{ id: 'p1', type: 'plan' }, { id: 'p2', type: 'expanded-plan' }];
    const features = [mkFeature('parent', 'p2'), mkFeature('child', 'p1', 'parent')];
    expect(assignFeatureToSwimlane(
      features[1], lanes, new Map(features.map((feature) => [feature.id, feature])),
      { ...noContext, child: true }
    )).toBe('p1');
  });

  it('moves selected child-plan work into an available ancestor lane in Parent Context', () => {
    const lanes = [{ id: 'p2', type: 'plan' }, { id: 'p1', type: 'expanded-plan' }];
    const features = [mkFeature('parent', 'p1'), mkFeature('child', 'p2', 'parent')];
    expect(assignFeatureToSwimlane(
      features[1], lanes, new Map(features.map((feature) => [feature.id, feature])),
      { ...noContext, parent: true }
    )).toBe('p1');
  });

  it('gives an owning higher-level group precedence over a selected descendant lane', () => {
    const lanes = [{ id: 'p1', type: 'plan' }, { id: 'p2', type: 'plan' }];
    const feature = mkFeature('child', 'p2');
    expect(assignFeatureToSwimlane(feature, lanes, new Map(), noContext, 'p1')).toBe('p1');
  });

  it('walks arbitrary parent depth into the selected plan lane under hierarchy Context', () => {
    const lanes = [{ id: 'p1', type: 'plan' }, { id: 'p3', type: 'expanded-plan' }];
    const features = [
      mkFeature('root', 'p1'),
      mkFeature('middle', 'p3', 'root'),
      mkFeature('leaf', 'p3', 'middle'),
    ];
    expect(assignFeatureToSwimlane(
      features[2], lanes, new Map(features.map((feature) => [feature.id, feature])),
      { ...noContext, parent: true }
    )).toBe('p1');
  });

  it('uses an expanded source-plan lane for Other allocations', () => {
    const lanes = [{ id: 'p1', type: 'plan' }, { id: 'p3', type: 'expanded-plan' }];
    expect(assignFeatureToSwimlane(
      mkFeature('other', 'p3'), lanes, new Map(),
      { ...noContext, otherAllocations: true }
    )).toBe('p3');
  });

  it('terminates deterministically for a cyclic parent chain', () => {
    const lanes = [{ id: 'p1', type: 'plan' }, { id: 'p3', type: 'expanded-plan' }];
    const features = [mkFeature('one', 'p3', 'two'), mkFeature('two', 'p3', 'one')];
    expect(assignFeatureToSwimlane(
      features[0], lanes, new Map(features.map((feature) => [feature.id, feature])),
      { ...noContext, parent: true }
    )).toBe('p3');
  });
});