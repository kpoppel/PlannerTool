import { BaseConfigComponent } from './BaseConfigComponent.lit.js';

export class AdminSystem extends BaseConfigComponent {
  get configType() { return 'system'; }
  get title() { return 'System Configuration'; }
  get defaultContent() { return {}; }
}

customElements.define('admin-system', AdminSystem);
