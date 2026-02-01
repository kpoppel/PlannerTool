import { BaseConfigComponent } from './BaseConfigComponent.lit.js';

export class AdminCost extends BaseConfigComponent {
  get configType() { return 'cost'; }
  get title() { return 'Cost Configuration'; }
  get defaultContent() { 
    return {
      schema_version: 1,
      working_hours: {},
      internal_cost: { default_hourly_rate: 78 },
      external_cost: { default_hourly_rate: 120, external: {} }
    };
  }
}

customElements.define('admin-cost', AdminCost);
