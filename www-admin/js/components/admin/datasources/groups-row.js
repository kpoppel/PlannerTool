/**
 * Groups domain row renderer for the DataSources admin panel.
 *
 * The Groups domain currently supports only one backend: "local" (diskcache).
 * The row is therefore rendered as a selectable row that always shows
 * "Local database" — mirroring the Scenarios and Views rows but keeping the
 * backend selector visible so a second backend (e.g. shared SQL) can be added
 * later without a structural change to the table.
 *
 * Expected comp properties (read/write):
 *   _groupsBackend {string} — currently only 'local'
 */
import { html } from '/static/js/vendor/lit.js';

/**
 * Render the Groups table row.
 * @param {DataSources} comp
 */
export function renderGroupsRow(comp) {
  return html`
    <tr>
      <td>
        <div class="domain-name">Groups</div>
        <div class="domain-desc">
          Virtual bands that visually segment the feature board — plan-scoped,
          stored only in PlannerTool (not synchronised to Azure DevOps).
        </div>
      </td>
      <td>
        <div class="backend-select-wrap">
          <select class="backend-select"
            @change=${(e) => { comp._groupsBackend = e.target.value; }}
          >
            <option value="local" ?selected=${comp._groupsBackend === 'local'}>
              Local database (PlannerTool)
            </option>
          </select>
        </div>
      </td>
      <td class="ttl-col"><span class="ttl-dash">—</span></td>
    </tr>`;
}
