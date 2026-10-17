import { html } from '../vendor/lit.js';
import { featureTags, toTitle } from './PortfolioPluginUtils.js';

/**
 * Render sidebar-filtered tasks and their team allocation editors.
 * @param {object} options
 * @param {object[]} options.features - Sidebar-filtered features
 * @param {boolean} options.isOpen - Whether the panel is open
 * @param {boolean} options.isBoardCollapsed - Whether the board is collapsed
 * @param {function} options.onToggle - Callback when panel toggle is clicked
 * @param {function} options.onSelectFeature - Callback when a feature row is clicked
 * @param {function} options.getProjectColor - Callback to get project color for a feature
 * @param {function} options.getProjectName - Callback to get project name for a feature
 * @returns {TemplateResult}
 */
export function renderUnallocatedPanel({
  features,
  allocationTeams,
  availableTeams,
  allocation,
  readonly,
  getAllocationCell,
  onAddTeam,
  onAllocationChange,
  onAllocationWheel,
  onDateChange,
  isOpen,
  isBoardCollapsed,
  onToggle,
  onSelectFeature,
  getProjectColor,
  getProjectName,
}) {
  const subtitle = `${features.length} task${features.length === 1 ? '' : 's'}`;
  const unit = allocation.unit === 'man-days' ? 'MD' : '%';

  const expandedClass = isBoardCollapsed ? 'expanded' : '';

  return html`
    <div class="unalloc-panel ${expandedClass}">
      <div class="panel-header" @click="${onToggle}">
        <span class="panel-title">Tasks</span>
        <span class="panel-subtitle">${subtitle}</span>
        <span class="panel-toggle ${isOpen ? 'up' : ''}">▼</span>
      </div>

      ${isOpen
        ? html`
            <div class="unalloc-scroll">
              <table class="ugrid" style="min-width:${960 + allocationTeams.length * 96}px;">
                <colgroup>
                  <col style="width:68px;" />
                  <col />
                </colgroup>
                <colgroup>
                  ${allocationTeams.map(() => html`<col style="width:96px;" />`)}
                  <col style="width:44px;" />
                </colgroup>
                <colgroup>
                  <col style="width:120px;" />
                  <col style="width:144px;" />
                  <col style="width:144px;" />
                  <col style="width:100px;" />
                  <col style="width:120px;" />
                </colgroup>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Title</th>
                    ${allocationTeams.map((team) => html`
                      <th class="allocation-heading" title=${team.name}>${team.name} (${unit})</th>
                    `)}
                    <th class="allocation-add" @click=${(event) => event.stopPropagation()}>
                      ${readonly || availableTeams.length === 0 ? '' : html`
                        <details class="allocation-team-picker">
                          <summary title="Add allocation team" aria-label="Add allocation team column">
                            +
                          </summary>
                          <select aria-label="Add allocation team" @change=${(event) => {
                            if (event.target.value === '') return;
                            onAddTeam(event.target.value);
                            event.target.value = '';
                            event.target.closest('details').open = false;
                          }}>
                            <option value="">Select team</option>
                            ${availableTeams.map((team) => html`
                              <option value=${team.id}>${team.name}</option>
                            `)}
                          </select>
                        </details>
                      `}
                    </th>
                    <th>Project</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>State</th>
                    <th>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  ${features.length === 0
                    ? html`<tr class="empty-row"><td colspan=${8 + allocationTeams.length}>No tasks match the sidebar filters</td></tr>`
                    : features.map((feature) => {
                        const tags = featureTags(feature);
                        const depthMargin = feature.depth * 16;
                        return html`
                          <tr @click="${() => onSelectFeature(feature)}">
                            <td style="padding-left:${depthMargin + 12}px;"><strong>${feature.id}</strong></td>
                            <td>${toTitle(feature.title)}</td>
                            ${allocationTeams.map((team) => {
                              const cell = getAllocationCell(feature, team.id);
                              return html`<td class="allocation-cell" title=${cell.reason}
                                @click=${(event) => event.stopPropagation()}>
                                <input class="allocation-input" type="number" min="0"
                                  max=${cell.max} step="1" required
                                  aria-label=${`${feature.id} ${team.name} allocation ${unit}`}
                                  ?disabled=${readonly || cell.reason !== ''}
                                  .value=${String(cell.value)}
                                  @input=${(event) => event.target.setCustomValidity('')}
                                  @change=${(event) => onAllocationChange(feature, team.id, event.target)}
                                  @keydown=${(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      onAllocationChange(feature, team.id, event.target);
                                    } else if (event.key === 'Escape') {
                                      event.target.value = String(cell.value);
                                      event.target.setCustomValidity('');
                                    }
                                  }}
                                  @wheel=${(event) => onAllocationWheel(event, feature, team.id)}
                                />
                              </td>`;
                            })}
                            <td></td>
                            <td>
                              <span
                                class="badge badge-proj"
                                style="background:${getProjectColor(feature)}"
                              >
                                ${getProjectName(feature)}
                              </span>
                            </td>
                            ${['start', 'end'].map((field) => html`
                              <td class="date-cell" @click=${(event) => event.stopPropagation()}>
                                <input class="date-input" type="date"
                                  aria-label=${`${feature.id} ${field} date`}
                                  ?disabled=${readonly}
                                  .value=${feature[field] ? feature[field] : ''}
                                  @change=${(event) => onDateChange(feature, field, event.target)}
                                  @keydown=${(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      onDateChange(feature, field, event.target);
                                    } else if (event.key === 'Escape') {
                                      event.target.value = feature[field] ? feature[field] : '';
                                    }
                                  }}
                                />
                              </td>
                            `)}
                            <td>
                              <span class="state-cell">
                                <span class="state-cell-dot"></span>
                                ${feature.state}
                              </span>
                            </td>
                            <td>
                              ${tags.length
                                ? tags.map((tag) => html`<span class="badge badge-tag">${tag}</span>`)
                                : html`<span style="color:#64748b;">-</span>`}
                            </td>
                          </tr>
                        `;
                      })}
                </tbody>
              </table>
            </div>
          `
        : ''}
    </div>
  `;
}
