import { BaseConfigComponent } from './BaseConfigComponent.lit.js';

export class AdminProjects extends BaseConfigComponent {
  get configType() { return 'projects'; }
  get title() { return 'Projects Configuration'; }
  get defaultContent() { return { project_map: [] }; }
}

customElements.define('admin-projects', AdminProjects);
