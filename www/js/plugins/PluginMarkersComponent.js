/**
 * PluginMarkersComponent - Displays delivery plan markers as timeline overlay
 */
import { html, css } from '../vendor/lit.js';
import { OverlaySvgComponent } from './OverlaySvgComponent.js';
import { findInBoard } from '../components/board-utils.js';
import { boardCoords } from '../services/BoardCoordinateService.js';
import { TIMELINE_CONFIG, getTimelineMonths } from '../components/Timeline.lit.js';
import { bus } from '../core/EventBus.js';
import { TimelineEvents, ProjectEvents, TeamEvents, BoardEvents } from '../core/EventRegistry.js';
import { pluginManager } from '../core/PluginManager.js';

export class PluginMarkersComponent extends OverlaySvgComponent {
  static overlayClass = 'markers-overlay-svg';

  static properties = {
    markers: { type: Array },
    loading: { type: Boolean },
    selectedColors: { type: Object },
    selectedPlans: { type: Object },
  };

  constructor() {
    super();
    this.markers = [];
    this.loading = false;
    this.selectedColors = {}; // Map of color -> boolean
    this.selectedPlans = {};  // Map of plan_id -> boolean
  }

  get _api() {
    if (!this.api) throw new Error('PluginMarkersComponent requires PlannerApi');
    return this.api;
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

    .plan-list {
      margin-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .plan-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 4px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s;
      user-select: none;
    }

    .plan-row:hover {
      background: #f0f0f0;
    }

    .plan-row.hidden {
      opacity: 0.4;
    }

    .plan-swatch {
      flex-shrink: 0;
      width: 12px;
      height: 12px;
      border-radius: 2px;
      border: 1px solid rgba(0,0,0,0.2);
    }

    .plan-name {
      font-size: 11px;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 140px;
    }

    .plan-count {
      margin-left: auto;
      font-size: 10px;
      color: #888;
      flex-shrink: 0;
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
    if (changedProperties.has('markers') || changedProperties.has('selectedColors') || changedProperties.has('selectedPlans')) {
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
      const selectedProjects = (this._api.selection.getProjects() || [])
        .filter((p) => p.selected)
        .map((p) => p.id);
      const selectedTeams = (this._api.selection.getTeams() || [])
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
          // Check plan filter
          const planMatch = this.selectedPlans[m.plan_id] !== false;
          return projectMatch && teamMatch && planMatch;
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
            ${!this.loading && this._getPlansLegend().length > 0 ?
              html`
                <div class="plan-list">
                  ${this._getPlansLegend().map((plan) => html`
                    <div
                      class="plan-row ${this.selectedPlans[plan.plan_id] === false ? 'hidden' : ''}"
                      @click="${() => this._togglePlan(plan.plan_id)}"
                      title="${this.selectedPlans[plan.plan_id] === false ? 'Show' : 'Hide'}: ${plan.plan_name}"
                    >
                      <div class="plan-swatch" style="background:${plan.color}"></div>
                      <span class="plan-name">${plan.plan_name}</span>
                      <span class="plan-count">${plan.count}</span>
                    </div>
                  `)}
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
    bus.emit(BoardEvents.OVERLAY_OFFSET_CHANGED, { offset: 0 });
    super.close();
  }

  async refresh() {
    this.loading = true;
    try {
      this.markers = (await this._api.markers.getAll()) || [];
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
    // Keep _getUniqueColors around in case other code uses it, but now we
    // primarily track visibility per plan.
    const legend = this._getPlansLegend();
    const newPlans = {};
    legend.forEach(({ plan_id }) => {
      newPlans[plan_id] =
        this.selectedPlans[plan_id] !== undefined ? this.selectedPlans[plan_id] : true;
    });
    this.selectedPlans = newPlans;
    // Keep selectedColors in sync for any legacy callers.
    const newColors = {};
    legend.forEach(({ color }) => {
      newColors[color] = this.selectedColors[color] !== undefined ? this.selectedColors[color] : true;
    });
    this.selectedColors = newColors;
  }

  /**
   * Return deduplicated list of plans with their representative color and marker count.
   * @returns {{ plan_id: string, plan_name: string, color: string, count: number }[]}
   */
  _getPlansLegend() {
    /** @type {Map<string, {plan_id:string, plan_name:string, color:string, count:number}>} */
    const byPlan = new Map();
    const seen = new Set();
    for (const m of this.markers) {
      if (!m.marker?.date) continue;
      const dedupeKey = `${m.plan_id}:${m.marker.date}:${m.marker.label || m.marker.title || ''}`;
      const isNew = !seen.has(dedupeKey);
      seen.add(dedupeKey);
      if (!byPlan.has(m.plan_id)) {
        byPlan.set(m.plan_id, {
          plan_id: m.plan_id,
          plan_name: m.plan_name || m.plan_id || 'Unknown plan',
          color: m.marker?.color || '#2196F3',
          count: 0,
        });
      }
      if (isNew) byPlan.get(m.plan_id).count++;
    }
    return Array.from(byPlan.values()).sort((a, b) => a.plan_name.localeCompare(b.plan_name));
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

  _togglePlan(planId) {
    const current = this.selectedPlans[planId] !== false;
    this.selectedPlans = { ...this.selectedPlans, [planId]: !current };
    this._scheduleRender();
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
    if (!this.markers.length) {
      bus.emit(BoardEvents.OVERLAY_OFFSET_CHANGED, { offset: 0 });
      return;
    }

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

    if (!months?.length) {
      bus.emit(BoardEvents.OVERLAY_OFFSET_CHANGED, { offset: 0 });
      return;
    }

    // Size SVG to viewport only
    this._svgEl.setAttribute('width', boardRect.width);
    this._svgEl.setAttribute('height', boardRect.height);
    this._svgEl.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);

    // Force style recalculation to ensure proper rendering
    this._svgEl.style.width = `${boardRect.width}px`;
    this._svgEl.style.height = `${boardRect.height}px`;

    // Filter markers by selected projects and teams
    const selectedProjects = (this._api.selection.getProjects() || [])
      .filter((p) => p.selected)
      .map((p) => p.id);
    const selectedTeams = (this._api.selection.getTeams() || [])
      .filter((team) => team.selected)
      .map((team) => team.id);

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
      // Plan visibility toggle
      const planMatch = this.selectedPlans[markerEntry.plan_id] !== false;

      // Must match all criteria
      return projectMatch && teamMatch && planMatch;
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

    // ------------------------------------------------------------------
    // Anti-overlap layout pass
    // ------------------------------------------------------------------
    // Assign a vertical "row" level to each marker so that labels whose
    // rendered rectangles would overlap are stacked.  Level 0 sits just
    // below the sticky header; level 1 is one tag-height lower, etc.
    //
    // Algorithm: greedy interval packing per row.
    // Each row tracks the rightmost X edge of the last label placed there.
    // We assign the first row whose tail does not overlap this label.
    const TAG_HEIGHT = 18;
    const TAG_PADDING = 6;

    // Compute label width the same way _createMarker does.
    const _labelWidth = (label) => label.length * 5.5 + TAG_PADDING * 2;

    // Pre-compute X positions, skip out-of-range markers.
    const markerLayouts = uniqueMarkers
      .map((markerEntry) => {
        const marker = markerEntry.marker;
        const x = this._calcX(new Date(marker.date), months, monthWidth);
        if (x === null) return null;
        const label = marker.label || marker.title || 'Marker';
        const w = _labelWidth(label);
        return { markerEntry, x, label, w };
      })
      .filter(Boolean);

    // Sort by X so greedy row assignment works left-to-right.
    markerLayouts.sort((a, b) => a.x - b.x);

    // rowTails[i] = rightmost edge already placed on row i.
    const rowTails = [];
    for (const layout of markerLayouts) {
      const halfW = layout.w / 2;
      const left  = layout.x - halfW;
      const right = layout.x + halfW;
      let row = rowTails.findIndex((tail) => tail <= left);
      if (row === -1) row = rowTails.length; // open a new row
      rowTails[row] = right;
      layout.row = row;
    }

    for (const { markerEntry, x, label, row } of markerLayouts) {
      const marker = markerEntry.marker;
      this._createMarker(
        x,
        label,
        marker.color || '#2196F3',
        markerEntry,
        boardRect.height,
        boardCoords.scrollY,
        row,
      );
      renderedCount++;
    }

    // Broadcast the clearance FeatureBoard needs so its first card row does not
    // overlap with marker tags. Formula: 5px top gap + N rows × (18px tag + 2px gap) + 4px margin.
    const usedRows = rowTails.length;
    bus.emit(BoardEvents.OVERLAY_OFFSET_CHANGED, {
      offset: usedRows === 0 ? 0 : 7 + usedRows * 20,
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

  _createMarker(x, label, color, markerEntry, boardHeight, scrollY, row = 0) {
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
    // row > 0 shifts overlapping labels downward by one tag-height per level.
    const tagGroup = document.createElementNS(SVG_NS, 'g');
    tagGroup.setAttribute('class', 'marker-tag');
    tagGroup.style.cursor = 'pointer';
    tagGroup.style.pointerEvents = 'auto';

    // Tag dimensions
    const tagHeight = 18;
    const tagY = (scrollY ?? 0) + 5 + row * (tagHeight + 2); // stack rows downward
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
