import { expect, vi, beforeEach, afterEach, describe, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import '../../www-admin/js/components/admin/Projects.lit.js';

describe('admin-projects', () => {
  let comp;
  beforeEach(() => {
    comp = document.createElement('admin-projects');
    document.body.appendChild(comp);
  });

  afterEach(() => {
    if (comp) comp.remove();
  });

  it('syncs display_states when include_states are added and removed', async () => {
    // initialize content with one project with empty states
    comp.content = {
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
        project_map: [
          { name: 'My Team', area_path: 'MyProj\\TeamA', task_types: [], include_states: [], display_states: [] },
        ],
      };
      await comp.updateComplete;

      comp.editProject(0);
      await new Promise((r) => setTimeout(r, 50));
      await comp.updateComplete;

      expect(comp._editMetadata).to.equal(null);
      expect(comp._editMetadataError).to.include('Could not load metadata');
    });
  });
});
