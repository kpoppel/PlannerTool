import { html, unsafeSVG } from '../vendor/lit.js';
import {
  TIMELINE_HEADER_HEIGHT,
  TIMELINE_LABEL_WIDTH,
  buildPortfolioTimelineLayout,
  buildPortfolioTimelineSvgMarkup,
  formatTimelineMonthLabel,
} from './portfolioTimeline.js';
import { state } from '../services/State.js';

const TIMELINE_FADED_CATEGORIES = new Set(['completed', 'removed']);

/**
 * Get the category for a timeline bar
 * @param {object} feature
 * @returns {string}
 */
function getTimelineBarCategory(feature) {
  const category = state.featureStateService?.getCategoryForState?.(feature?.state);
  return String(category || '').toLowerCase();
}

/**
 * Get the opacity for a timeline bar based on its category
 * @param {object} feature
 * @returns {number}
 */
function getTimelineBarOpacity(feature) {
  return TIMELINE_FADED_CATEGORIES.has(getTimelineBarCategory(feature)) ? 0.36 : 0.92;
}

/**
 * Get the tooltip text for a timeline bar
 * @param {object} feature
 * @param {string} projectName
 * @returns {string}
 */
function getTimelineBarTooltip(feature, projectName) {
  const start = feature?.start || '-';
  const end = feature?.end || '-';
  return `${feature?.id || ''}\n${toTitle(feature?.title)}\n${projectName}\n${start} -> ${end}`.trim();
}

/**
 * Helper to format title
 * @param {string} value
 * @returns {string}
 */
function toTitle(value) {
  return String(value || '').trim() || 'Untitled';
}

/**
 * Render the timeline panel with SVG visualization
 * @param {object} options
 * @param {object} options.layout - Timeline layout from buildPortfolioTimelineLayout
 * @param {object} options.projectById - Map of project ID to project object
 * @param {boolean} options.isOpen - Whether the timeline panel is open
 * @param {function} options.onToggle - Callback when the panel is toggled
 * @param {function} options.getProjectColor - Callback to get project color for a feature
 * @returns {TemplateResult}
 */
export function renderPortfolioTimeline({
  layout,
  projectById,
  isOpen,
  onToggle,
  getProjectColor,
}) {
  const hasTimeline = !layout.empty;
  const subtitle = hasTimeline
    ? `${formatTimelineMonthLabel(layout.months[0])} -> ${formatTimelineMonthLabel(layout.months[layout.months.length - 1])}`
    : 'No dated tasks in the current selection';

  const getProjectName = (feature) => {
    const project = projectById[String(feature?.project || '')];
    return project?.name || feature?.project || 'Unknown';
  };

  const timelineSvg = hasTimeline
    ? unsafeSVG(
        buildPortfolioTimelineSvgMarkup(layout, {
          getBarColor: getProjectColor,
          getBarOpacity: (feature) => getTimelineBarOpacity(feature),
          getBarTooltip: (feature) => getTimelineBarTooltip(feature, getProjectName(feature)),
        })
      )
    : null;

  return html`
    <div class="timeline-panel">
      <div class="panel-header" @click=${onToggle}>
        <span class="panel-title">Timeline Overview</span>
        <span class="panel-subtitle timeline-summary">${subtitle}</span>
        <span class="panel-toggle ${isOpen ? 'up' : ''}">▼</span>
      </div>

      ${isOpen
        ? hasTimeline
          ? html`
              <div class="timeline-body">
                <div class="timeline-labels" style="width:${TIMELINE_LABEL_WIDTH}px;">
                  <div class="timeline-label" style="height:${TIMELINE_HEADER_HEIGHT}px;">Teams</div>
                  ${layout.rows.map(
                    (row) => html`<div class="timeline-label" style="height:${row.height}px;">
                      <span class="tc-dot" style="background:${row.color}"></span>
                      ${row.label}
                    </div>`
                  )}
                </div>
                <div class="timeline-svg-wrap">${timelineSvg}</div>
              </div>
            `
          : html`<div class="timeline-empty">No dated tasks in the current selection.</div>`
        : ''}
    </div>
  `;
}
