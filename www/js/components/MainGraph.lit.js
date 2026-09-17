// www/js/components/MainGraph.lit.js
// Lit 3.3.1 web component for main organizational load graph

import { LitElement, html, css } from '../vendor/lit.js';
import { sel } from '../application/imports.js';
import { bus } from '../core/EventBus.js';
import { getTimelineMonths, TIMELINE_CONFIG } from '../components/Timeline.lit.js';
import {
  CapacityEvents,
  FeatureEvents,
  ProjectEvents,
  TeamEvents,
  FilterEvents,
  StateFilterEvents,
  TimelineEvents,
  ViewEvents,
} from '../core/EventRegistry.js';
import { findInBoard } from './board-utils.js';
import { boardCoords } from '../services/BoardCoordinateService.js';

/**
 * MainGraphLit - Lit-based main graph component with canvas rendering
 * @property {Object} bus - EventBus instance for emitting events
 * @property {number} width - Canvas width in pixels
 * @property {number} height - Canvas height in pixels
 */
export class MainGraphLit extends LitElement {
  static properties = {
    bus: { type: Object },
    width: { type: Number },
    height: { type: Number },
  };

  constructor() {
    super();
    this.bus = null;
    this.width = 800;
    this.height = 120;
    this._canvasRef = null;
    this._renderData = null;
    this._hoverDays = [];
    this._graphTooltip = null;
    // constructor
    this._resizeObserver = null;
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .graph-container {
      width: 100%;
      // height: 100%;
      height: 120px;
      position: relative;
      // z-index: 5;
      background: #b0cbe6;
      border-bottom: 0px solid var(--color-border);
      //padding:0;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
      cursor: crosshair;
    }

    .graph-tooltip {
      position: absolute;
      z-index: 1000;
      top: 8px;
      min-width: 150px;
      max-width: 260px;
      padding: 8px 10px;
      border: 1px solid var(--color-border, #8fa5b9);
      background: rgba(255, 255, 255, 0.96);
      color: var(--color-text, #1f2933);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      font-size: 12px;
      line-height: 1.35;
      pointer-events: none;
    }

    .graph-tooltip[data-side='left'] {
      transform: translateX(-100%);
    }

    .graph-tooltip-date {
      margin-bottom: 4px;
      font-weight: 600;
    }

    .graph-tooltip-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .graph-tooltip-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .graph-tooltip-swatch {
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-right: 5px;
      vertical-align: middle;
    }
  `;

  render() {
    const graphScopeLabel =
      'Organization-wide capacity load. Sidebar display filters do not change this graph.';
    return html`
      <div class="graph-container">
        <canvas
          id="graphCanvas"
          width="${this.width}"
          height="${this.height}"
          aria-label="${graphScopeLabel}"
          @pointermove=${this._onGraphPointerMove}
          @pointerleave=${this._onGraphPointerLeave}
        ></canvas>
        ${this._graphTooltip ? html`
          <div
            class="graph-tooltip"
            role="tooltip"
            data-side="${this._graphTooltip.side}"
            style="left: ${this._graphTooltip.x}px; z-index: 1000"
          >
            <div class="graph-tooltip-date">${this._graphTooltip.date}</div>
            ${this._graphTooltip.entries.map((entry) => html`
              <div class="graph-tooltip-row">
                <span class="graph-tooltip-label">
                  <span class="graph-tooltip-swatch" style="background: ${entry.color}"></span>${entry.name}
                </span>
                <span>${Math.round(entry.value)}%</span>
              </div>
            `)}
          </div>
        ` : ''}
      </div>
    `;
  }

  _onGraphPointerMove(event) {
    if (!this._canvasRef || this._hoverDays.length === 0) return;
    const rect = this._canvasRef.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = (event.clientX - rect.left) * this._canvasRef.width / rect.width;
    const hoveredDay = this._hoverDays.find((day) => x >= day.startX && x <= day.endX);
    if (hoveredDay === undefined) {
      this._onGraphPointerLeave();
      return;
    }
    const offset = 12;
    const side = x < this._canvasRef.width / 2 ? 'right' : 'left';
    this._graphTooltip = {
      ...hoveredDay,
      x: side === 'right' ? x + offset : x - offset,
      side,
    };
    this.requestUpdate();
  }

  _onGraphPointerLeave() {
    if (this._graphTooltip === null) return;
    this._graphTooltip = null;
    this.requestUpdate();
  }

  firstUpdated() {
    this._canvasRef = this.shadowRoot.getElementById('graphCanvas');
    // Observe host size changes to keep canvas pixel buffer in sync
    try {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._renderData) {
          // Re-render on next frame
          requestAnimationFrame(() => this.renderGraph(this._renderData));
        }
      });
      this._resizeObserver.observe(this);
    } catch (e) {
      /* ResizeObserver may not be available in some test envs */
    }
    // Setup event-driven scheduler so component owns its rendering lifecycle
    this._maingraphScheduled = false;
    this._maingraphScrollScheduled = false;
    this._maingraphUnsubs = [];
    const buildSnapshot = () => {
      const months = getTimelineMonths();
      // Use expansion-aware project IDs so the graph is consistent with the
      // feature cards shown on the board (e.g. when expand-by-allocation is on).
      const selectedProjectIds = sel.selection.getEffectiveSelectedProjectIds();
      const contextTeamIds = new Set(sel.scope.getContextTeams().map((id) => String(id)));
      const selectedTeamIds = sel.selection.getSelectedTeamIds()
        .filter((id) => contextTeamIds.has(String(id)));
      return {
        months,
        teams: sel.selection.getTeams(),
        projects: sel.selection.getProjects(),
        capacityDates: sel.capacity.getCapacityDates(),
        teamDailyCapacity: sel.capacity.getTeamDailyCapacity(),
        teamDailyCapacityMap: sel.capacity.getTeamDailyCapacityMap(),
        projectDailyCapacity: sel.capacity.getProjectDailyCapacity(),
        projectDailyCapacityMap: sel.capacity.getProjectDailyCapacityMap(),
        totalOrgDailyPerTeamAvg: sel.capacity.getTotalOrgDailyPerTeamAvg(),
        capacityViewMode: sel.view.getCapacityViewMode(),
        selectedTeamIds,
        selectedProjectIds,
        selectedFeatureStateFilter: sel.filter.getSelectedFeatureStateSet(),
      };
    };

    // Render when DATA changes (expensive: rebuilds snapshot and re-renders)
    const scheduleDataRender = async () => {
      if (this._maingraphScheduled) return;
      this._maingraphScheduled = true;
      requestAnimationFrame(async () => {
        this._maingraphScheduled = false;
        const snapshot = buildSnapshot();
        await this.updateComplete;
        await this.renderGraph(snapshot);
      });
    };

    // Render when SCROLL changes (fast: reuses cached snapshot, just re-renders with new viewport)
    const scheduleScrollRender = () => {
      if (this._maingraphScrollScheduled) return;
      this._maingraphScrollScheduled = true;
      requestAnimationFrame(() => {
        this._maingraphScrollScheduled = false;
        // Reuse cached snapshot; _fullRender will recalculate visible range from scroll position
        if (this._renderData) {
          this.renderGraph(this._renderData);
        }
      });
    };

    // Subscribe to bus events (data changes → full rebuild)
    this._maingraphUnsubs.push(bus.on(CapacityEvents.UPDATED, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(FeatureEvents.UPDATED, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(ProjectEvents.CHANGED, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(TeamEvents.CHANGED, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(FilterEvents.CHANGED, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(StateFilterEvents.CHANGED, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(TimelineEvents.MONTHS, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(TimelineEvents.SCALE_CHANGED, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(TimelineEvents.SCALE_COMPLETE, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(ViewEvents.CAPACITY_MODE, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(ViewEvents.CONDENSED, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(ViewEvents.DEPENDENCIES, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(ViewEvents.DISPLAY_MODE, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(ViewEvents.SORT_MODE, scheduleDataRender));
    this._maingraphUnsubs.push(bus.on(ViewEvents.HIGHLIGHT_RELATIONS, scheduleDataRender));

    // Listen for scroll via boardCoords (fast scroll render without rebuilding snapshot)
    this._maingraphScrollUnsubscribe = boardCoords.subscribe(scheduleScrollRender);

    // Initial render
    scheduleDataRender();
  }

  disconnectedCallback() {
    super.disconnectedCallback && super.disconnectedCallback();
    if (this._resizeObserver) this._resizeObserver.disconnect();
    // Unsubscribe from bus events
    if (this._maingraphUnsubs && Array.isArray(this._maingraphUnsubs)) {
      this._maingraphUnsubs.forEach((u) => {
        u();
      });
      this._maingraphUnsubs = null;
    }
    // Unsubscribe from scroll
    if (this._maingraphScrollUnsubscribe) {
      this._maingraphScrollUnsubscribe();
      this._maingraphScrollUnsubscribe = null;
    }
  }

  /**
   * Public API: Render graph with provided data
   * @param {Object} data - Graph data including months, teamData, projectData
   */
  async renderGraph(data) {
    if (!this._canvasRef || !data) return;

    this._renderData = data;
    this._hoverDays = [];
    this._graphTooltip = null;

    // Extract commonly used data fields (fall back to empty arrays/maps)
    const months = Array.isArray(data.months) ? data.months : [];
    const teams = Array.isArray(data.teams) ? data.teams : [];
    const allProjects = Array.isArray(data.projects) ? data.projects : [];
    // For project view rendering, we'll filter to only show type='project', but we calculate for all
    const capacityDates = Array.isArray(data.capacityDates) ? data.capacityDates : [];
    const teamDailyCapacity = Array.isArray(data.teamDailyCapacity) ? data.teamDailyCapacity : [];
    const teamDailyCapacityMap = data.teamDailyCapacityMap || null;
    const projectDailyCapacity = Array.isArray(data.projectDailyCapacity) ? data.projectDailyCapacity : [];
    const projectDailyCapacityMap = data.projectDailyCapacityMap || null;
    const totalOrgDailyPerTeamAvg = Array.isArray(data.totalOrgDailyPerTeamAvg) ? data.totalOrgDailyPerTeamAvg : [];
    const capacityViewMode = data.capacityViewMode || 'team';
    const selectedTeamIds = new Set(data.selectedTeamIds);
    const selectedProjectIds = new Set(
      Array.isArray(data.selectedProjectIds)
        ? data.selectedProjectIds
        : allProjects.filter((p) => p?.selected).map((p) => p.id)
    );
    const selectedFeatureStateFilter = data.selectedFeatureStateFilter || null;

    // Get canvas context
    const ctx = this._canvasRef.getContext('2d');
    if (!ctx) return;

    // If months not provided, nothing to draw
    if (months.length === 0) {
      ctx.clearRect(0, 0, this._canvasRef.width, this._canvasRef.height);
      return;
    }

    // Prefer the component's host size; fall back to scroll container width or configured defaults
    const hostRect = this.getBoundingClientRect ? this.getBoundingClientRect() : null;
    const scrollContainer = findInBoard('#scroll-container');
    const desiredWidth =
      hostRect && hostRect.width ? Math.floor(hostRect.width)
      : scrollContainer ? scrollContainer.clientWidth
      : this.width || 800;
    const desiredHeight =
      hostRect && hostRect.height ? Math.floor(hostRect.height) : this.height || 120;
    // Only update canvas backing buffer when dimensions changed to avoid unnecessary redraws
    if (
      this._canvasRef.width !== desiredWidth ||
      this._canvasRef.height !== desiredHeight
    ) {
      this._canvasRef.width = desiredWidth;
      this._canvasRef.height = desiredHeight;
    }

    // Clear canvas
    ctx.clearRect(0, 0, this._canvasRef.width, this._canvasRef.height);

    // Delegate to full renderer
    this._fullRender(ctx, {
      months,
      teams,
      projects: allProjects,
      capacityDates,
      teamDailyCapacity,
      teamDailyCapacityMap,
      projectDailyCapacity,
      projectDailyCapacityMap,
      totalOrgDailyPerTeamAvg,
      capacityViewMode,
      selectedTeamIds,
      selectedProjectIds,
      selectedFeatureStateFilter,
    });
  }

  /**
   * Internal: Render graph content to canvas
   * @private
   */
  _renderGraphContent(ctx, months, teamData, projectData) {
    // Left for compatibility with older tests - not used when full renderer is present
    const graphHeight = this._canvasRef ? this._canvasRef.height : this.height;
    const graphWidth = this._canvasRef ? this._canvasRef.width : this.width;

    // Draw background
    ctx.fillStyle = '#f7f7f7';
    ctx.fillRect(0, 0, graphWidth, graphHeight);

    // Draw baseline
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, graphHeight / 2);
    ctx.lineTo(graphWidth, graphHeight / 2);
    ctx.stroke();
  }

  _fullRender(ctx, stateSnapshot) {
    // _fullRender start
    // Ported rendering logic adapted from www/js/mainGraph.js
    const {
      months,
      teams,
      projects,
      capacityDates,
      teamDailyCapacity,
      teamDailyCapacityMap,
      projectDailyCapacity,
      projectDailyCapacityMap,
      totalOrgDailyPerTeamAvg,
      capacityViewMode,
      selectedTeamIds,
      selectedProjectIds,
    } = stateSnapshot;

    const selectedTeamIdSet = new Set(Array.from(selectedTeamIds).map((id) => String(id)));
    const selectedProjectIdSet = new Set(
      Array.from(selectedProjectIds).map((id) => String(id))
    );

    const MONTH_WIDTH = TIMELINE_CONFIG.monthWidth;

    function daysInMonth(d) {
      return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    }

    function hexToRgba(hex, alpha) {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (!m) {
        return `rgba(231,76,60,${alpha})`;
      }
      const r = parseInt(m[1], 16),
        g = parseInt(m[2], 16),
        b = parseInt(m[3], 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    const msPerDay = 24 * 60 * 60 * 1000;
    function dateToIndex(monthsArr, date) {
      const start = monthsArr[0];
      return Math.floor((date - start) / msPerDay);
    }
    // indexToDate is expensive (allocates); only use when absolutely needed. Provide a minimal version.
    function indexToDate(monthsArr, idx) {
      const start = monthsArr[0];
      return new Date(start.getTime() + idx * msPerDay);
    }
    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }

    // Visible range: use boardCoords for scroll position and container width
    const scrollContainer = findInBoard('#scroll-container');
    let range = { startDate: months[0], endDate: months[months.length - 1] };
    let viewportOffsetPx = 0; // Offset from the start of visibleStartIdx to the viewport left edge

    {
      const scrollLeft =
        scrollContainer && Number.isFinite(scrollContainer.scrollLeft) ?
          scrollContainer.scrollLeft
        : boardCoords.scrollX;
      const viewportWidth =
        scrollContainer && scrollContainer.clientWidth > 0 ?
          scrollContainer.clientWidth
        : 0;
      const width = viewportWidth || this._canvasRef?.width || 800;

      // Calculate which dates are visible in the viewport
      const startMonthIdx = Math.floor(scrollLeft / MONTH_WIDTH);
      const startMonthOffsetPx = scrollLeft - startMonthIdx * MONTH_WIDTH;
      const startMonthDate = months[clamp(startMonthIdx, 0, months.length - 1)];
      const startMonthDays = daysInMonth(startMonthDate);
      const startDay = Math.floor((startMonthOffsetPx / MONTH_WIDTH) * startMonthDays);
      const startDate = new Date(
        startMonthDate.getFullYear(),
        startMonthDate.getMonth(),
        1 + startDay
      );

      const endPx = scrollLeft + width;
      const endMonthIdx = Math.floor(endPx / MONTH_WIDTH);
      const endMonthOffsetPx = endPx - endMonthIdx * MONTH_WIDTH;
      const endMonthDate = months[clamp(endMonthIdx, 0, months.length - 1)];
      const endMonthDays = daysInMonth(endMonthDate);
      const endDay = Math.floor((endMonthOffsetPx / MONTH_WIDTH) * endMonthDays);
      const endDate = new Date(
        endMonthDate.getFullYear(),
        endMonthDate.getMonth(),
        1 + endDay
      );
      range = { startDate, endDate };

      // Calculate the pixel offset
      const pxPerDayInStartMonth = MONTH_WIDTH / startMonthDays;
      const exactDayInMonth = (startMonthOffsetPx / MONTH_WIDTH) * startMonthDays;
      const subDayOffset = (exactDayInMonth - startDay) * pxPerDayInStartMonth;
      viewportOffsetPx = subDayOffset;
    }

    // Build date map
    const dateIndexMap = new Map((capacityDates || []).map((ds, i) => [ds, i]));

    const rawVisibleStartIdx = dateToIndex(months, range.startDate);
    const rawVisibleEndIdx = dateToIndex(months, range.endDate);

    // Precompute month/day metadata and per-day pixel widths for the full timeline; we'll only populate visible range
    const monthDayCounts = new Array(months.length);
    const monthStartDayIdx = new Array(months.length);
    let dayCursor = 0;
    for (let mi = 0; mi < months.length; mi++) {
      const m = months[mi];
      const dcount = daysInMonth(m);
      monthDayCounts[mi] = dcount;
      monthStartDayIdx[mi] = dayCursor;
      dayCursor += dcount;
    }

    const dayCount = dayCursor;
    const visibleStartIdx = clamp(rawVisibleStartIdx, 0, dayCount - 1);
    const visibleEndIdx = clamp(rawVisibleEndIdx, visibleStartIdx, dayCount - 1);

    // Build per-day px widths and cumulative X positions for visible range only
    const dayX = new Array(visibleEndIdx - visibleStartIdx + 2); // include nextX
    const dayWidth = new Array(visibleEndIdx - visibleStartIdx + 1);

    // Start cumX at negative offset to account for the portion of the first day before viewport
    let cumX = -viewportOffsetPx;

    // compute starting month index
    let mi = 0;
    while (
      mi < months.length &&
      monthStartDayIdx[mi] + monthDayCounts[mi] <= visibleStartIdx
    )
      mi++;
    for (; mi < months.length; mi++) {
      const monthStart = monthStartDayIdx[mi];
      const daysThis = monthDayCounts[mi];
      const pxPerDay = MONTH_WIDTH / daysThis;
      const dayBegin = Math.max(visibleStartIdx, monthStart);
      const dayEnd = Math.min(visibleEndIdx, monthStart + daysThis - 1);
      if (dayBegin > dayEnd) continue;
      for (let d = dayBegin; d <= dayEnd; d++) {
        const localIdx = d - visibleStartIdx;
        dayX[localIdx] = cumX;
        dayWidth[localIdx] = pxPerDay;
        cumX += pxPerDay;
      }
    }
    // nextX for visibleEnd+1
    dayX[visibleEndIdx - visibleStartIdx + 1] = cumX;

    // Build maps keyed by timeline dayIdx for the visible range
    const teamDayMap = new Map();
    const projectDayMap = new Map();
    const orgTotalsTeam = new Map();
    const orgTotalsProject = new Map();
    // Capacity is normalized against the organization roster, not the
    // presentation-only Team Drill-down selection.
    const nTeams = teams.length || 1;

    // A selected plan establishes the graph bands in both display modes.
    if (selectedProjectIdSet.size === 0) return;
    if (capacityViewMode === 'team' && selectedTeamIdSet.size === 0) return;

    for (let d = visibleStartIdx; d <= visibleEndIdx; d++) {
      const localIdx = d - visibleStartIdx;
      const idx = (() => {
        // build iso YYYY-MM-DD from months/monthStart/day offset without constructing Date when possible
        // fallback to Date for correctness
        try {
          const ms = months[0].getTime() + d * msPerDay;
          const iso = new Date(ms).toISOString().slice(0, 10);
          return dateIndexMap.get(iso);
        } catch (e) {
          const iso = indexToDate(months, d).toISOString().slice(0, 10);
          return dateIndexMap.get(iso);
        }
      })();
      if (idx === undefined) {
        teamDayMap.set(d, {});
        projectDayMap.set(d, {});
        orgTotalsTeam.set(d, 0);
        orgTotalsProject.set(d, 0);
        continue;
      }
      const teamBucket = {};
      let maxTeamVal = 0;
      const dayTeamMap = (teamDailyCapacityMap && teamDailyCapacityMap[idx]) || null;
      if (dayTeamMap) {
        for (const team of teams) {
          const v = dayTeamMap[team.id] || 0;
          if (!selectedTeamIdSet.has(String(team.id))) continue;
          teamBucket[team.id] = v;
          if (v > maxTeamVal) maxTeamVal = v;
        }
      } else {
        const tTuple = teamDailyCapacity[idx] || [];
        for (let i = 0; i < teams.length; i++) {
          const team = teams[i];
          const v = tTuple[i] || 0;
          if (!selectedTeamIdSet.has(String(team.id))) continue;
          teamBucket[team.id] = v;
          if (v > maxTeamVal) maxTeamVal = v;
        }
      }
      teamDayMap.set(d, teamBucket);

      // Project bucket - read from ALL projects but only add type='project' to display bucket
      const projectBucket = {};
      const dayProjectMap =
        (projectDailyCapacityMap && projectDailyCapacityMap[idx]) || null;
      if (dayProjectMap) {
        for (const project of projects) {
          const v = dayProjectMap[project.id] || 0;
          const isProjectType =
            (project && project.type ? String(project.type) : 'project') === 'project';
          // Only display type='project' projects, but we've read all data
          if (isProjectType && selectedProjectIdSet.has(String(project.id))) {
            projectBucket[project.id] = v / Math.max(1, nTeams);
          }
        }
        // Always include unfunded synthetic project if capacity calculator provided it
        if (dayProjectMap['__unfunded__']) {
          projectBucket['__unfunded__'] =
            dayProjectMap['__unfunded__'] / Math.max(1, nTeams);
        }
      } else {
        const pTuple = projectDailyCapacity[idx] || [];
        for (let i = 0; i < projects.length; i++) {
          const project = projects[i];
          const v = pTuple[i] || 0;
          const isProjectType =
            (project && project.type ? String(project.type) : 'project') === 'project';
          // Only display type='project' projects, but we've read all data
          if (isProjectType && selectedProjectIdSet.has(String(project.id))) {
            projectBucket[project.id] = v;
          }
        }
        // Always include unfunded synthetic project if capacity calculator provided it (last index in tuple)
        if (pTuple.length > projects.length) {
          const unfundedVal = pTuple[projects.length] || 0;
          if (unfundedVal > 0) {
            projectBucket['__unfunded__'] = unfundedVal;
          }
        }
      }
      projectDayMap.set(d, projectBucket);

      orgTotalsTeam.set(d, maxTeamVal);
      let totalPerTeam = 0;
      if (dayProjectMap) {
        for (const proj of projects) {
          if (!selectedProjectIdSet.has(String(proj.id))) continue;
          const isProjectType =
            (proj && proj.type ? String(proj.type) : 'project') === 'project';
          if (!isProjectType) continue;
          totalPerTeam += (dayProjectMap[proj.id] || 0) / Math.max(1, nTeams);
        }
        // Include unfunded in total if calculator provided it
        if (dayProjectMap['__unfunded__']) {
          totalPerTeam += dayProjectMap['__unfunded__'] / Math.max(1, nTeams);
        }
      } else {
        for (let i = 0; i < projects.length; i++) {
          const proj = projects[i];
          if (!selectedProjectIdSet.has(String(proj.id))) continue;
          const isProjectType =
            (proj && proj.type ? String(proj.type) : 'project') === 'project';
          if (!isProjectType) continue;
          totalPerTeam +=
            projectDailyCapacity[idx] && projectDailyCapacity[idx][i] ?
              projectDailyCapacity[idx][i]
            : 0;
        }
        // Include unfunded in total if calculator provided it (last index)
        const pTuple = projectDailyCapacity[idx] || [];
        if (pTuple.length > projects.length) {
          const unfundedValue = pTuple[projects.length];
          if (unfundedValue !== undefined) totalPerTeam += unfundedValue;
        }
      }
      orgTotalsProject.set(d, totalPerTeam);

      const date = capacityDates[idx] !== undefined ?
        capacityDates[idx]
      : indexToDate(months, d).toISOString().slice(0, 10);
      const entries = capacityViewMode === 'team' ?
        teams
          .filter((team) => selectedTeamIdSet.has(String(team.id)))
          .map((team) => ({
            name: team.name === undefined ? String(team.id) : team.name,
            color: team.color === undefined ? '#888' : team.color,
            value: teamBucket[team.id],
          }))
      : projects
          .filter((project) => projectBucket[project.id] !== undefined)
          .map((project) => ({
            name: project.name === undefined ? String(project.id) : project.name,
            color: project.color === undefined ? '#888' : project.color,
            value: projectBucket[project.id],
          }));
      if (capacityViewMode === 'project' && projectBucket.__unfunded__ !== undefined) {
        entries.push({ name: 'Unfunded', color: '#C49E78', value: projectBucket.__unfunded__ });
      }
      this._hoverDays.push({
        startX: dayX[localIdx],
        endX: dayX[localIdx + 1],
        date,
        entries,
      });
    }

    function pxPerDay(date) {
      return MONTH_WIDTH / daysInMonth(date);
    }
    function xForDayIndex(dayIdx) {
      let cum = 0;
      const startDate = new Date(range.startDate);
      let curIdx = dateToIndex(months, startDate);
      const curDate = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate()
      );
      while (curIdx < dayIdx) {
        cum += pxPerDay(curDate);
        curDate.setDate(curDate.getDate() + 1);
        curIdx++;
      }
      return Math.floor(cum);
    }

    const usingTeam = capacityViewMode === 'team';
    const chosenMap = usingTeam ? teamDayMap : projectDayMap;
    const chosenTotals = usingTeam ? orgTotalsTeam : orgTotalsProject;

    // compute maxTotal
    let maxTotal = 0;
    if (usingTeam) {
      for (let d = visibleStartIdx; d <= visibleEndIdx; d++) {
        const bucket = teamDayMap.get(d) || {};
        for (const team of teams) {
          const v = bucket[team.id] || 0;
          if (v > maxTotal) maxTotal = v;
        }
      }
    } else {
      for (let d = visibleStartIdx; d <= visibleEndIdx; d++) {
        const total = chosenTotals.get(d) || 0;
        if (total > maxTotal) maxTotal = total;
      }
    }
    const maxYPercent = Math.max(100, Math.ceil(maxTotal * 1.1));
    const bottomBand = 8;
    const drawHeight = this._canvasRef.height - bottomBand;
    const percentToPx = drawHeight / maxYPercent;

    // overload bands
    let inSpan = false;
    let spanStartX = 0;
    for (let d = visibleStartIdx; d <= visibleEndIdx; d++) {
      const total = chosenTotals.get(d) || 0;
      const localIdx = d - visibleStartIdx;
      const x = Math.floor(dayX[localIdx]);
      const nextX = Math.floor(dayX[localIdx + 1]);
      const over = total > 100;
      if (over && !inSpan) {
        inSpan = true;
        spanStartX = x;
      }
      if (!over && inSpan) {
        ctx.fillStyle = `${hexToRgba(TIMELINE_CONFIG.overloadBgColor, TIMELINE_CONFIG.overloadBgAlpha)}`;
        ctx.fillRect(spanStartX, 0, x - spanStartX, this._canvasRef.height);
        inSpan = false;
      }
      if (d === visibleEndIdx && inSpan) {
        ctx.fillStyle = `${hexToRgba(TIMELINE_CONFIG.overloadBgColor, TIMELINE_CONFIG.overloadBgAlpha)}`;
        ctx.fillRect(spanStartX, 0, nextX - spanStartX, this._canvasRef.height);
        inSpan = false;
      }
    }

    // dayX array already precomputed (indexed by localIdx = day - visibleStartIdx)

    // Draw content
    if (usingTeam) {
      const teamPoints = teams.map(() => []);
      const daySegments = [];
      for (let d = visibleStartIdx; d <= visibleEndIdx; d++) {
        const localIdx = d - visibleStartIdx;
        const x = Math.floor(dayX[localIdx]);
        const nextX = Math.floor(dayX[localIdx + 1]);
        const bucket = chosenMap.get(d) || {};
        const total = chosenTotals.get(d) || 0;
        daySegments.push({ dayIdx: d, startX: x, endX: nextX, total });
        for (let ti = 0; ti < teams.length; ti++) {
          const teamId = teams[ti].id;
          const val = bucket[teamId] || 0;
          const y = drawHeight - val * percentToPx;
          teamPoints[ti].push({ x, y, val, dayIdx: d });
        }
      }
      // subtle grid
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.04)';
      ctx.lineWidth = 1;
      for (const entry of daySegments) {
        const x = entry.startX;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, drawHeight);
        ctx.stroke();
      }
      ctx.restore();
      for (let ti = 0; ti < teams.length; ti++) {
        const team = teams[ti];
        if (!selectedTeamIdSet.has(String(team.id))) continue;
        const pts = teamPoints[ti];
        if (!pts.length) continue;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (i === 0) ctx.moveTo(p.x + 0.5, p.y);
          else ctx.lineTo(p.x + 0.5, p.y);
        }
        ctx.strokeStyle = team.color || '#888';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else {
      for (let d = visibleStartIdx; d <= visibleEndIdx; d++) {
        const bucket = chosenMap.get(d) || {};
        let y = drawHeight;
        const localIdx = d - visibleStartIdx;
        const x = Math.floor(dayX[localIdx]);
        const nextX = Math.floor(dayX[localIdx + 1]);
        const dayWidth = Math.max(1, nextX - x);

        // Render unfunded synthetic project first (bottom) using a subtle pastel brown,
        // so it doesn't dominate the visual hierarchy.
        const unfundedVal = bucket['__unfunded__'] || 0;
        if (unfundedVal > 0) {
          const h = clamp(
            Math.round(unfundedVal * percentToPx),
            0,
            this._canvasRef.height
          );
          ctx.fillStyle = '#C49E78'; // pastel brown (less dominant)
          ctx.fillRect(x, y - h, dayWidth, h);
          y -= h;
        }

        // Render regular projects with type='project' using their project color
        for (const project of projects) {
          if (project.id === '__unfunded__') continue; // already handled
          const isProjectType =
            (project && project.type ? String(project.type) : 'project') === 'project';
          if (!isProjectType) continue;
          const val = bucket[project.id] || 0;
          if (val <= 0) continue;
          const h = clamp(Math.round(val * percentToPx), 0, this._canvasRef.height);
          ctx.fillStyle = project.color || '#888';
          ctx.fillRect(x, y - h, dayWidth, h);
          y -= h;
        }
      }
    }

    // 100% dotted line
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    const y100 = drawHeight - Math.round(100 * percentToPx);
    ctx.moveTo(0, y100);
    ctx.lineTo(this._canvasRef.width, y100);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Public API: Update viewport/scroll position
   * @param {Object} viewport - Viewport info with scrollLeft, scrollTop
   */
  updateViewport(viewport) {
    // Re-render with current data if viewport changes
    if (this._renderData) {
      this.renderGraph(this._renderData);
    }
  }

  /**
   * Get the canvas element
   * @returns {HTMLCanvasElement} Canvas element
   */
  getCanvas() {
    return this._canvasRef;
  }
}

// Register the custom element
customElements.define('maingraph-lit', MainGraphLit);
