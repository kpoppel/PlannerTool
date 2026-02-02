import { BaseConfigComponent } from './BaseConfigComponent.lit.js';

export class AdminTeams extends BaseConfigComponent {
  get configType() { return 'teams'; }
  get title() { return 'Teams Configuration'; }
  get defaultContent() { return { team_map: [] }; }
}

customElements.define('admin-teams', AdminTeams);
