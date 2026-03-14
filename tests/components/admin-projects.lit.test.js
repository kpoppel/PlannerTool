import { expect } from '@esm-bundle/chai';
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
    comp.content = { project_map: [{ name: 'P1', include_states: [], display_states: [] }] };
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
});
