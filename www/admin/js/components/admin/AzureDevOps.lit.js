import { BaseConfigComponent } from './BaseConfigComponent.lit.js';

/**
 * Admin panel for Azure DevOps-specific configuration.
 *
 * Edits the ado_config object stored in diskcache:
 *   { organization_url: string, feature_flags: { use_azure_mock: bool, ... } }
 *
 * The JSON Schema for this panel is fetched from /admin/v1/schema/ado and is
 * built dynamically by BackendRegistry so future backends (Jira, etc.)
 * automatically appear here without UI changes.
 */
export class AzureDevOps extends BaseConfigComponent {
  get configType() {
    return 'ado';
  }

  get title() {
    return 'Azure DevOps Configuration';
  }

  get defaultContent() {
    return {
      organization_url: '',
      feature_flags: {},
    };
  }
}

customElements.define('admin-ado', AzureDevOps);
