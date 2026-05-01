import { BaseConfigComponent } from './BaseConfigComponent.lit.js';

/**
 * Admin panel for event-backend configuration.
 *
 * Lets the admin choose between:
 *   "local"    — events stored in the PlannerTool diskcache database (default)
 *   "ado_wiki" — events persisted as a structured Azure DevOps wiki page
 *
 * The JSON Schema for this panel is fetched from /admin/v1/schema/eventsConfig
 * (defined statically in planner_lib/admin/schema.py as 'events_config').
 *
 * Config is stored in diskcache under config::event_config and served via
 * GET/POST /admin/v1/events-config.
 */
export class Events extends BaseConfigComponent {
  get configType() {
    return 'eventsConfig';
  }

  get title() {
    return 'Events Configuration';
  }

  get defaultContent() {
    return {
      event_backend: 'local',
    };
  }
}

customElements.define('admin-events', Events);
