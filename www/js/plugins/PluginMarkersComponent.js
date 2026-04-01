/**
 * PluginMarkersComponent - Displays delivery plan markers as timeline overlay
 */
import { html, css } from '../vendor/lit.js';
import { OverlaySvgPlugin } from './OverlaySvgPlugin.js';
import { findInBoard } from '../components/board-utils.js';
import { boardCoords } from '../services/BoardCoordinateService.js';
import { TIMELINE_CONFIG, getTimelineMonths } from '../components/Timeline.lit.js';
import { bus } from '../core/EventBus.js';
import { TimelineEvents, ProjectEvents, TeamEvents } from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';
import { state } from '../services/State.js';
import { pluginManager } from '../core/PluginManager.js';

export class PluginMarkersComponent extends OverlaySvgPlugin {
  static overlayClass = 'markers-overlay-svg';

  static properties = {
    markers: { type: Array },
    loading: { type: Boolean },
    selectedColors: { type: Object },
  };

  constructor() {
    super();
    this.markers = [];
    this.loading = false;
    this.selectedColors = {}; // Map of color -> boolean
  }

  static styles = css`
    :host {
      display: none;
      position: fixed;
      z-index: 200;
      pointer-events: none;
    }

    :host([visible]) {
      display: block;
    }

    .floating-toolbar {
      position: fixed;
      top: 80px;
      right: 20px;
      background: white;
      padding: 12px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      pointer-events: auto;
      z-index: 200;
      min-width: 140px;
    }

    .toolbar-title {
      font-size: 12px;
      font-weight: 600;
      color: #666;
      margin-bottom: 8px;
      text-transform: uppercase;
    }

    button {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
      font-size: 13px;
      width: 100%;
      margin-bottom: 4px;
    }

    button:hover {
      background: #f5f5f5;
      border-color: #ccc;
    }

    .close-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      padding: 0;
      background: transparent;
      border: none;
      color: #999;
      font-size: 16px;
      cursor: pointer;
      border-radius: 4px;
      margin: 0;
    }

    .close-btn:hover {
      color: #333;
      background: #f0f0f0;
    }

    .marker-count {
      font-size: 11px;
      background: #e8f5e9;
      color: #2e7d32;
      padding: 2px 6px;
      border-radius: 10px;
      margin-top: 8px;
      display: inline-block;
    }

    .color-filters {
      margin-top: 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .color-filter-btn {
      width: 20px;
      height: 20px;
      border: 2px solid #ccc;
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .color-filter-btn.selected {
      border-color: #000;
      box-shadow: 0 0 0 1px #000;
    }

    .color-filter-btn:hover {
      transform: scale(1.1);
    }
  `;

  _subscribeBusEvents() {
    this._timelineListener = () => this._scheduleRender();
    this._selectionListener = () => {
      this._scheduleRender();
      this.requestUpdate(); // also refresh toolbar counts
    };

    bus.on(TimelineEvents.MONTHS_CHANGED, this._timelineListener);
    bus.on(TimelineEvents.SCALE_CHANGED, this._timelineListener);
    bus.on(ProjectEvents.CHANGED, this._selectionListener);
    bus.on(TeamEvents.CHANGED, this._selectionListener);
  }

  _unsubscribeBusEvents() {
    if (this._timelineListener) {
      bus.off(TimelineEvents.MONTHS_CHANGED, this._timelineListener);
      bus.off(TimelineEvents.SCALE_CHANGED, this._timelineListener);
    }
    if (this._selectionListener) {
      bus.off(ProjectEvents.CHANGED, this._selectionListener);
      bus.off(TeamEvents.CHANGED, this._selectionListener);
    }
  }

  updated(changedProperties) {
    if (changedProperties.has('markers') || changedProperties.has('selectedColors')) {
      this._renderSvg();
    }
  }

  render() {
    // Calculate unique total marker count
    let totalUniqueCount = 0;
    if (this.markers.length > 0) {
      const seen = new Set();
      totalUniqueCount = this.markers.filter((m) => {
        if (!m.marker?.date) return false;
        const key = `${m.plan_id}:${m.marker.date}:${m.marker.label || m.marker.title || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).length;
    }

    // Calculate filtered count for display
    let displayCount = totalUniqueCount;
    if (this.visible && this.markers.length > 0) {
      const selectedProjects = (state.projects || [])
        .filter((p) => p.selected)
        .map((p) => p.id);
      const selectedTeams = (state.teams || [])
        .filter((t) => t.selected)
        .map((t) => t.id);

      const hasProjectSelection = selectedProjects.length > 0;
      const hasTeamSelection = selectedTeams.length > 0;

      // If no project is selected, show nothing
      if (!hasProjectSelection) {
        displayCount = 0;
      } else {
        const filtered = this.markers.filter((m) => {
          const projectMatch = selectedProjects.includes(m.project);
          // When no teams are selected, treat all teams as matching;
          // otherwise filter to selected teams (team-agnostic markers always pass)
          const teamMatch = !hasTeamSelection || !m.team_id || selectedTeams.includes(m.team_id);
          // Check color filter
          const markerColor = m.marker?.color || '#2196F3';
          const colorMatch = this.selectedColors[markerColor] !== false;
          return projectMatch && teamMatch && colorMatch;
        });

        // Deduplicate by plan_id + date + label
        const seen = new Set();
        displayCount = filtered.filter((m) => {
          if (!m.marker?.date) return false;
          const key = `${m.plan_id}:${m.marker.date}:${m.marker.label || m.marker.title || ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).length;
      }
    }

    return this.visible ?
        html`
          <div class="floating-toolbar">
            <button class="close-btn" @click="${this._handleClose}" title="Close">
              ×
            </button>
            <div class="toolbar-title">Plan Markers</div>
            <button @click="${this.refresh}" ?disabled="${this.loading}">
              ${this.loading ? '⏳ Loading...' : '🔄 Refresh'}
            </button>
            ${!this.loading && totalUniqueCount > 0 ?
              html`
                <div class="marker-count">
                  ${displayCount}
                  ${displayCount !== totalUniqueCount ? `of ${totalUniqueCount}` : ''}
                  markers
                </div>
              `
            : ''}
            ${!this.loading && displayCount > 0 && displayCount !== totalUniqueCount ?
              html`
                <div style="font-size: 10px; color: #666; margin-top: 4px;">
                  Filtered by selected teams/projects
                </div>
              `
            : ''}
            ${!this.loading && this._getUniqueColors().length > 0 ?
              html`
                <div class="color-filters">
                  ${this._getUniqueColors().map(
                    (color) => html`
                      <div
                        class="color-filter-btn ${this.selectedColors[color] !== false ?
                          'selected'
                        : ''}"
                        style="background-color: ${color}"
                        @click="${() => this._toggleColor(color)}"
                        title="${color}: ${this.selectedColors[color] !== false ?
                          'Hide'
                        : 'Show'}"
                      ></div>
                    `
                  )}
                </div>
              `
            : ''}
          </div>
        `
      : '';
  }

  async open() {
    super.open();
    await this.refresh();
  }

  _handleClose() {
    // Call plugin.deactivate() which will call this.close()
    const plugin = pluginManager.get('plugin-markers');
    if (plugin) plugin.deactivate();
  }

  close() {
    super.close();
  }

  async refresh() {
    this.loading = true;
    try {
      this.markers = (await dataService.getMarkers()) || [];
      // Initialize selected colors - all colors selected by default
      this._initializeColorSelection();
    } catch (err) {
      console.error('[PluginMarkers] Failed to load markers:', err);
      this.markers = [];
    } finally {
      this.loading = false;
    }
  }

  _initializeColorSelection() {
    const colors = this._getUniqueColors();
    const newSelection = {};
    colors.forEach((color) => {
      // Keep existing selection state if color already exists
      newSelection[color] =
        this.selectedColors[color] !== undefined ? this.selectedColors[color] : true;
    });
    this.selectedColors = newSelection;
  }

  _getUniqueColors() {
    const colors = new Set();
    this.markers.forEach((m) => {
      const color = m.marker?.color || '#2196F3';
      colors.add(color);
    });
    return Array.from(colors).sort();
  }

  _toggleColor(color) {
    this.selectedColors = {
      ...this.selectedColors,
      [color]: !this.selectedColors[color],
    };
  }

  _renderSvg() {
    if (!this.visible || !this._svgEl) return;

    // Reattach overlay if it was removed from the DOM
    if (!this._svgEl.isConnected) {
      this._attachOverlay();
      if (!this._svgEl?.isConnected) return;
    }

    // Clear existing markers (do this even if markers.length is 0)
    this._svgEl.innerHTML = '';

    // If no markers loaded yet, nothing more to do
    if (!this.markers.length) return;

    const board = findInBoard('feature-board');
    const brClient = board.getBoundingClientRect();
    const boardRect = {
      left: brClient.left,
      top: brClient.top,
      width: brClient.width,
      height: brClient.height,
    };
    const monthWidth = TIMELINE_CONFIG.monthWidth;
    const months = getTimelineMonths();

    if (!months?.length) return;

    // Size SVG to viewport only
    this._svgEl.setAttribute('width', boardRect.width);
    this._svgEl.setAttribute('height', boardRect.height);
    this._svgEl.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);

    // Force style recalculation to ensure proper rendering
    this._svgEl.style.width = `${boardRect.width}px`;
    this._svgEl.style.height = `${boardRect.height}px`;

    // Filter markers by selected projects and teams
    const selectedProjects = (state.projects || [])
      .filter((p) => p.selected)
      .map((p) => p.id);
    const selectedTeams = (state.teams || []).filter((t) => t.selected).map((t) => t.id);

    const debugCount = 0;
    const filteredMarkers = this.markers.filter((markerEntry) => {
      // When no project is selected, show nothing
      const hasProjectSelection = selectedProjects.length > 0;
      const hasTeamSelection = selectedTeams.length > 0;

      if (!hasProjectSelection) return false;

      // Check if marker's project matches selection
      const projectMatch = selectedProjects.includes(markerEntry.project);
      // When no teams are selected, treat all teams as matching;
      // otherwise filter to selected teams (team-agnostic markers always pass)
      const teamMatch =
        !hasTeamSelection || !markerEntry.team_id || selectedTeams.includes(markerEntry.team_id);
      // Check color filter
      const markerColor = markerEntry.marker?.color || '#2196F3';
      const colorMatch = this.selectedColors[markerColor] !== false;

      // Must match all criteria
      return projectMatch && teamMatch && colorMatch;
    });

    // Deduplicate markers by plan_id + date + label
    const seen = new Set();
    const uniqueMarkers = filteredMarkers.filter((markerEntry) => {
      const marker = markerEntry.marker;
      if (!marker?.date) return false;

      const key = `${markerEntry.plan_id}:${marker.date}:${marker.label || marker.title || ''}`;
      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });

    let renderedCount = 0;
    uniqueMarkers.forEach((markerEntry) => {
      const marker = markerEntry.marker;

      const x = this._calcX(new Date(marker.date), months, monthWidth);
      if (x === null) return;

      this._createMarker(
        x,
        marker.label || marker.title || 'Marker',
        marker.color || '#2196F3',
        markerEntry,
        boardRect.height,
        boardCoords.scrollY
      );
      renderedCount++;
    });
  }

  /**
   * Convert a date to board-space X. Returns null for dates outside the timeline range.
   * (boardCoords.dateToContentX clamps to bounds; we skip out-of-range markers instead.)
   */
  _calcX(date, months, monthWidth) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const monthIndex = months.findIndex(
      (m) => m.getFullYear() === year && m.getMonth() === month
    );
    if (monthIndex === -1) return null;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayRatio = (date.getDate() - 1) / daysInMonth;
    return (monthIndex + dayRatio) * monthWidth;
  }

  _createMarker(x, label, color, markerEntry, boardHeight, scrollY) {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // Vertical dashed line from top of board area to its bottom
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', 0);
    line.setAttribute('x2', x);
    line.setAttribute('y2', boardHeight);
    line.setAttribute('stroke', color);
    line.setAttribute('opacity', '0.4');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '4,4');
    line.style.pointerEvents = 'none';
    this._svgEl.appendChild(line);

    // Create compact tag that sticks to the top of the visible board area.
    // tagY is in board-area coordinates: scrollY offsets the tag so its
    // screen position stays constant just below the sticky timeline header.
    const tagGroup = document.createElementNS(SVG_NS, 'g');
    tagGroup.setAttribute('class', 'marker-tag');
    tagGroup.style.cursor = 'pointer';
    tagGroup.style.pointerEvents = 'auto';

    // Tag dimensions
    const tagHeight = 18;
    const tagY = (scrollY ?? 0) + 5; // Offset by scrollY so tag sticks to visible top
    const tagPadding = 6;
    const labelWidth = label.length * 5.5;
    const tagWidth = labelWidth + tagPadding * 2;

    // Tag background with rounded corners
    const tagBg = document.createElementNS(SVG_NS, 'rect');
    tagBg.setAttribute('x', x - tagWidth / 2);
    tagBg.setAttribute('y', tagY);
    tagBg.setAttribute('width', tagWidth);
    tagBg.setAttribute('height', tagHeight);
    tagBg.setAttribute('fill', color);
    tagBg.setAttribute('rx', '3');
    tagBg.setAttribute('opacity', '0.9');
    tagGroup.appendChild(tagBg);

    // Tag label
    const tagText = document.createElementNS(SVG_NS, 'text');
    tagText.setAttribute('x', x);
    tagText.setAttribute('y', tagY + 13);
    tagText.setAttribute('fill', 'white');
    tagText.setAttribute('font-size', '10');
    tagText.setAttribute('font-weight', '600');
    tagText.setAttribute('text-anchor', 'middle');
    tagText.textContent = label;
    tagGroup.appendChild(tagText);

    // Tooltip
    const title = document.createElementNS(SVG_NS, 'title');
    const tooltipParts = [
      label,
      markerEntry.plan_name ? `Plan: ${markerEntry.plan_name}` : '',
      markerEntry.marker.date ? `Date: ${markerEntry.marker.date.slice(0, 10)}` : '',
    ].filter(Boolean);
    title.textContent = tooltipParts.join('\n');
    tagGroup.appendChild(title);

    this._svgEl.appendChild(tagGroup);
  }
}

customElements.define('plugin-markers', PluginMarkersComponent);
export default PluginMarkersComponent;
