import { BaseConfigComponent } from './BaseConfigComponent.lit.js';

export class AdminTeams extends BaseConfigComponent {
  get configType() { return 'teams'; }
  get title() { return 'Teams Configuration'; }
  get defaultContent() { return { schema_version: 2, teams: [] }; }
}

customElements.define('admin-teams', AdminTeams);
