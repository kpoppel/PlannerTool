import { expect, vi, beforeEach, afterEach, describe, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import '../../www/admin/js/components/admin/Projects.lit.js';
import { setMetadata } from '../../www/admin/js/services/azureMetadataCache.js';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';

describe('admin-projects', () => {
  let comp;
  beforeEach(() => {
    server.use(http.get('/admin/v1/projects', () => HttpResponse.json({ content: {
      schema_version: 4, container_types: ['project', 'team'], project_map: [],
      allocation_defaults: { project: [], team: [] },
    } })));
    vi.spyOn(adminProvider, 'getWorkforce').mockResolvedValue({ ok: true, data: { content: {
      teams: { schema_version: 3, teams: [], groups: [] },
    } } });
    comp = document.createElement('admin-projects');
    document.body.appendChild(comp);
  });

  afterEach(() => {
    if (comp) comp.remove();
    vi.restoreAllMocks();
  });

  it('edits canonical level defaults and distinguishes an empty override from inheritance', async () => {
    await vi.waitFor(() => expect(comp.loading).to.equal(false));
    comp.content = {
      schema_version: 4, container_types: ['project'],
      allocation_defaults: { project: ['opaque-team'] },
      project_map: [{ id: 'plan', name: 'Plan', type: 'project', area_path: 'Area' }],
    };
    await comp.updateComplete;
    comp.setProjectAllocationMode(0, false);
    expect(comp.localProjects[0].allocatable_ids).to.deep.equal([]);
    comp.setProjectAllocationChoice(0, 'opaque-team', true);
    expect(comp.localProjects[0].allocatable_ids).to.deep.equal(['opaque-team']);
    comp.setProjectAllocationMode(0, true);
    expect(Object.hasOwn(comp.localProjects[0], 'allocatable_ids')).to.equal(false);
    comp.setLevelAllocationChoice('project', 'opaque-team', false);
    expect(comp.content.allocation_defaults.project).to.deep.equal([]);
    comp.newContainerType = 'portfolio';
    comp.addContainerType();
    expect(comp.content.allocation_defaults.portfolio).to.deep.equal([]);
    comp.removeContainerType('portfolio');
    expect(Object.hasOwn(comp.content.allocation_defaults, 'portfolio')).to.equal(false);
  });

  it('syncs display_states when include_states are added and removed', async () => {
    // initialize content with one project with empty states
    comp.content = {
      container_types: ['project', 'team'],
      allocation_defaults: { project: [], team: [] },
      project_map: [{ name: 'P1', include_states: [], display_states: [] }],
    };
    await comp.requestUpdate();

    // add an include_state and expect it to appear in display_states
    comp.addChip(0, 'include_states', 'NewState');
    await comp.updateComplete;
    expect(comp.localProjects[0].include_states).to.include('NewState');
    expect(comp.localProjects[0].display_states).to.include('NewState');

    // remove the include_state and expect it to be removed from display_states
    comp.removeChip(0, 'include_states', 'NewState');
    await comp.updateComplete;
    expect(comp.localProjects[0].include_states).to.not.include('NewState');
    expect(comp.localProjects[0].display_states).to.not.include('NewState');
  });

  it('resolves iteration set name by id for display', async () => {
    comp._iterationSets = [
      { id: 'set-1', name: 'Core Iterations' },
      { id: 'set-2', name: 'Platform Iterations' },
    ];

    expect(comp.iterationSetLabel('set-2')).to.equal('Platform Iterations');
    expect(comp.iterationSetLabel('unknown')).to.equal('unknown');
    expect(comp.iterationSetLabel('')).to.equal('');
  });

  it('edits ordered container types and keeps types assigned to plans', async () => {
    await vi.waitFor(() => expect(comp.loading).to.equal(false));
    comp.content = {
      container_types: ['B', 'A', 'C'],
      allocation_defaults: { B: [], A: [], C: [] },
      project_map: [{ name: 'Plan A', type: 'A' }],
    };
    await comp.updateComplete;

    comp.editProject(0);
    await comp.updateComplete;
    const options = [...comp.shadowRoot.querySelectorAll('tr.editing-row select option')]
      .map((option) => option.value);
    expect(options.slice(0, 3)).to.deep.equal(['B', 'A', 'C']);

    comp.removeContainerType('A');
    expect(comp.content.container_types).to.deep.equal(['B', 'A', 'C']);
    comp.moveContainerType(2, 0);
    expect(comp.content.container_types).to.deep.equal(['C', 'B', 'A']);

    comp.newContainerType = 'b';
    comp.addContainerType();
    expect(comp.content.container_types).to.deep.equal(['C', 'B', 'A']);
    comp.newContainerType = 'D';
    comp.addContainerType();
    expect(comp.content.container_types).to.deep.equal(['C', 'B', 'A', 'D']);
  });

  it('saves a newly added container assignment while the project row is still being edited', async () => {
    await vi.waitFor(() => expect(comp.loading).to.equal(false));
    comp.content = {
      container_types: ['project', 'team'],
      allocation_defaults: { project: [], team: [] },
      project_map: [{ name: 'Plan A', type: 'project', area_path: '' }],
    };
    await comp.updateComplete;

    comp.newContainerType = 'portfolio';
    comp.addContainerType();
    await comp.updateComplete;
    comp.editProject(0);
    await comp.updateComplete;

    const select = comp.shadowRoot.querySelector('tr.editing-row select');
    expect([...select.options].map((option) => option.value)).to.include('portfolio');
    select.value = 'portfolio';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await comp.updateComplete;

    const save = vi.spyOn(adminProvider, 'saveProjects').mockResolvedValue({ ok: true });
    const projectId = '11111111-1111-4111-8111-111111111111';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(projectId);
    try {
      await comp.saveConfig();
      expect(save).toHaveBeenCalledWith({
        container_types: ['project', 'team', 'portfolio'],
        allocation_defaults: { project: [], team: [], portfolio: [] },
        project_map: [{ id: projectId, name: 'Plan A', type: 'portfolio', area_path: '' }],
      });
    } finally {
      save.mockRestore();
    }
  });

  it('saves raw JSON without replacing it with an open project row draft', async () => {
    await vi.waitFor(() => expect(comp.loading).to.equal(false));
    comp.content = {
      container_types: ['project', 'team'],
      allocation_defaults: { project: [], team: [] },
      project_map: [{ name: 'Plan A', type: 'project', area_path: '' }],
    };
    await comp.updateComplete;
    comp.editProject(0);
    comp.updateProjectField(0, 'type', 'team');
    comp.useRawMode = true;
    comp.content = {
      container_types: ['project', 'team', 'portfolio'],
      allocation_defaults: { project: [], team: [], portfolio: [] },
      project_map: [{ name: 'Raw Plan', type: 'portfolio', area_path: '' }],
    };

    const save = vi.spyOn(adminProvider, 'saveProjects').mockResolvedValue({ ok: true });
    const projectId = '11111111-1111-4111-8111-111111111111';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(projectId);
    try {
      await comp.saveConfig();
      expect(save).toHaveBeenCalledWith({
        container_types: ['project', 'team', 'portfolio'],
        allocation_defaults: { project: [], team: [], portfolio: [] },
        project_map: [{ id: projectId, name: 'Raw Plan', type: 'portfolio', area_path: '' }],
      });
    } finally {
      save.mockRestore();
    }
  });

  describe('area-path metadata integration', () => {
    const METADATA = {
      types: ['Epic', 'Feature', 'User Story'],
      states: ['New', 'Active', 'Resolved', 'Closed'],
      states_by_type: {
        Epic: ['New', 'Active', 'Resolved', 'Closed'],
        Feature: ['New', 'Active', 'Resolved', 'Closed'],
        'User Story': ['New', 'Active', 'Resolved', 'Closed'],
      },
    };

    beforeEach(() => {
      server.use(
        http.get('/api/azure/area-path-metadata', () =>
          HttpResponse.json(METADATA, { status: 200 })
        )
      );
    });

    it('fetches metadata when editProject is called on a project with an area_path', async () => {
      comp.content = {
        container_types: ['project', 'team'],
        allocation_defaults: { project: [], team: [] },
        project_map: [
          { name: 'My Team', area_path: 'MyProj\\TeamA', task_types: [], include_states: [], display_states: [] },
        ],
      };
      await comp.updateComplete;

      comp.editProject(0);
      // Wait for the async fetch to complete
      await comp.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await comp.updateComplete;

      expect(comp._editMetadata).to.deep.equal(METADATA);
      expect(comp._editMetadataLoading).to.equal(false);
      expect(comp._editMetadataError).to.equal('');
    });

    it('clears _editMetadata when cancelEdit is called', async () => {
      comp.content = {
        container_types: ['project', 'team'],
        allocation_defaults: { project: [], team: [] },
        project_map: [
          { name: 'My Team', area_path: 'MyProj\\TeamA', task_types: [], include_states: [], display_states: [] },
        ],
      };
      await comp.updateComplete;

      comp.editProject(0);
      await new Promise((r) => setTimeout(r, 50));
      await comp.updateComplete;

      comp.cancelEdit();
      await comp.updateComplete;

      expect(comp._editMetadata).to.equal(null);
      expect(comp._editMetadataError).to.equal('');
    });

    it('clears stale metadata when area_path input changes', async () => {
      comp.content = {
        container_types: ['project', 'team'],
        allocation_defaults: { project: [], team: [] },
        project_map: [
          { name: 'My Team', area_path: 'MyProj\\TeamA', task_types: [], include_states: [], display_states: [] },
        ],
      };
      await comp.updateComplete;

      comp.editProject(0);
      await new Promise((r) => setTimeout(r, 50));
      await comp.updateComplete;
      expect(comp._editMetadata).to.deep.equal(METADATA);

      // Simulate manual edit of area_path — should clear cached metadata
      comp._editMetadata = null;
      comp._editMetadataError = '';
      comp.updateProjectField(0, 'area_path', 'MyProj\\TeamB');
      await comp.updateComplete;

      expect(comp._editMetadata).to.equal(null);
    });

    it('does not fetch metadata when editProject is called on a project without area_path', async () => {
      comp.content = {
        container_types: ['project', 'team'],
        allocation_defaults: { project: [], team: [] },
        project_map: [
          { name: 'New Project', area_path: '', task_types: [], include_states: [], display_states: [] },
        ],
      };
      await comp.updateComplete;

      comp.editProject(0);
      await new Promise((r) => setTimeout(r, 50));
      await comp.updateComplete;

      expect(comp._editMetadata).to.equal(null);
    });

    it('sets _editMetadataError when the API returns an error', async () => {
      server.use(
        http.get('/api/azure/area-path-metadata', () =>
          HttpResponse.json({ error: 'not connected' }, { status: 500 })
        )
      );

      comp.content = {
        container_types: ['project', 'team'],
        allocation_defaults: { project: [], team: [] },
        project_map: [
          { name: 'My Team', area_path: 'MyProj\\TeamA', task_types: [], include_states: [], display_states: [] },
        ],
      };
      await comp.updateComplete;

      // Ensure any previously-cached metadata for this Azure project is cleared
      // so the component performs the fetch and the error path is exercised.
      setMetadata('MyProj', null);

      comp.editProject(0);
      await new Promise((r) => setTimeout(r, 50));
      await comp.updateComplete;

      expect(comp._editMetadata).to.equal(null);
      expect(comp._editMetadataError).to.include('Could not load metadata');
    });
  });
});
