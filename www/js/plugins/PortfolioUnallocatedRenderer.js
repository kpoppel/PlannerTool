import { html } from '../vendor/lit.js';
import { featureTags, toTitle } from './PortfolioPluginUtils.js';

/**
 * Render the unallocated tasks panel with table
 * @param {object} options
 * @param {object[]} options.unallocated - Array of unallocated features
 * @param {boolean} options.isOpen - Whether the panel is open
 * @param {boolean} options.isBoardCollapsed - Whether the board is collapsed
 * @param {function} options.onToggle - Callback when panel toggle is clicked
 * @param {function} options.onSelectFeature - Callback when a feature row is clicked
 * @param {function} options.getProjectColor - Callback to get project color for a feature
 * @param {function} options.getProjectName - Callback to get project name for a feature
 * @returns {TemplateResult}
 */
export function renderUnallocatedPanel({
  unallocated,
  isOpen,
  isBoardCollapsed,
  onToggle,
  onSelectFeature,
  getProjectColor,
  getProjectName,
}) {
  const subtitle = unallocated.length
    ? `${unallocated.length} task${unallocated.length > 1 ? 's' : ''} need team assignment`
    : '- all tasks allocated';

  const expandedClass = isBoardCollapsed ? 'expanded' : '';

  return html`
    <div class="unalloc-panel ${expandedClass}">
      <div class="panel-header" @click="${onToggle}">
        <span class="panel-title">Unallocated Tasks</span>
        <span class="panel-subtitle">${subtitle}</span>
        <span class="panel-toggle ${isOpen ? 'up' : ''}">▼</span>
      </div>

      ${isOpen
        ? html`
            <div class="unalloc-scroll">
              <table class="ugrid">
                <thead>
                  <tr>
                    <th style="width:68px;">ID</th>
                    <th>Title</th>
                    <th style="width:130px;">Project</th>
                    <th style="width:110px;">Start</th>
                    <th style="width:110px;">End</th>
                    <th style="width:110px;">State</th>
                    <th>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  ${unallocated.length === 0
                    ? html`<tr class="empty-row"><td colspan="7">All tasks have team allocations</td></tr>`
                    : unallocated.map((feature) => {
                        const tags = featureTags(feature);
                        const depthMargin = (feature.depth || 0) * 16;
                        return html`
                          <tr @click="${() => onSelectFeature(feature)}">
                            <td style="padding-left:${depthMargin + 12}px;"><strong>${feature.id}</strong></td>
                            <td>${toTitle(feature.title)}</td>
                            <td>
                              <span
                                class="badge badge-proj"
                                style="background:${getProjectColor(feature)}"
                              >
                                ${getProjectName(feature)}
                              </span>
                            </td>
                            <td>${feature?.start || '-'}</td>
                            <td>${feature?.end || '-'}</td>
                            <td>
                              <span class="state-cell">
                                <span class="state-cell-dot"></span>
                                ${feature?.state || '-'}
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
