import { describe, expect, it } from 'vitest';
import { resolveFundedTargetProject } from '../../www/js/application/shared/ownership.js';

function maps(features, projects) {
  return {
    features: new Map(features.map((feature) => [String(feature.id), feature])),
    projects: new Map(projects.map((project) => [String(project.id), project])),
  };
}

describe('application/shared/ownership', () => {
  it('resolves a directly project-owned feature', () => {
    const { features, projects } = maps(
      [{ id: 'task', project: 'project' }],
      [{ id: 'project', type: 'project' }]
    );

    expect(resolveFundedTargetProject(features.get('task'), features, projects)).toBe('project');
  });

  it('walks multiple ancestors to the nearest project owner', () => {
    const { features, projects } = maps(
      [
        { id: 'task', project: 'team', parentId: 'story' },
        { id: 'story', project: 'team', parentId: 'epic' },
        { id: 'epic', project: 'project', parentId: null },
      ],
      [
        { id: 'team', type: 'team' },
        { id: 'project', type: 'project' },
      ]
    );

    expect(resolveFundedTargetProject(features.get('task'), features, projects)).toBe('project');
  });

  it('returns null for missing owners and cyclic parent chains', () => {
    const missing = maps([{ id: 'task', project: 'team' }], [{ id: 'team', type: 'team' }]);
    const cyclic = maps(
      [
        { id: 'a', project: 'team', parentId: 'b' },
        { id: 'b', project: 'team', parentId: 'a' },
      ],
      [{ id: 'team', type: 'team' }]
    );

    expect(resolveFundedTargetProject(missing.features.get('task'), missing.features, missing.projects)).toBeNull();
    expect(resolveFundedTargetProject(cyclic.features.get('a'), cyclic.features, cyclic.projects)).toBeNull();
  });

  it('memoizes the result per feature', () => {
    const { features, projects } = maps(
      [{ id: 'task', project: 'project' }],
      [{ id: 'project', type: 'project' }]
    );
    const memo = new Map();

    expect(resolveFundedTargetProject(features.get('task'), features, projects, memo)).toBe('project');
    features.get('task').project = 'missing';
    expect(resolveFundedTargetProject(features.get('task'), features, projects, memo)).toBe('project');
  });
});