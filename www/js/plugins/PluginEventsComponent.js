/**
 * PluginEventsComponent - Displays locally-stored plan events as a timeline overlay.
 *
 * Events are rendered at the BOTTOM of the SVG board area (markers render at the top),
 * so both can be visible simultaneously without overlapping.
 * When two events land on the same or adjacent X positions the tags are stacked
 * upward from the bottom edge.
 */
import { html, css } from '../vendor/lit.js';
import { OverlaySvgPlugin } from './OverlaySvgPlugin.js';
import { findInBoard } from '../components/board-utils.js';
import { boardCoords } from '../services/BoardCoordinateService.js';
import { TIMELINE_CONFIG, getTimelineMonths } from '../components/Timeline.lit.js';
import { bus } from '../core/EventBus.js';
import { TimelineEvents, ProjectEvents, PlanEventEvents } from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';
import { state } from '../services/State.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Minimum pixel gap between two tag centres before stacking upward. */
const TAG_CLUSTER_THRESHOLD = 60;

export class PluginEventsComponent extends OverlaySvgPlugin {
  static overlayClass = 'events-overlay-svg';
  static zIndex = '124'; // Just below markers (125) so they share the same SVG layer stack

  static properties = {
    events: { type: Array },
    loading: { type: Boolean },
  };

  constructor() {
    super();
    this.events = [];
    this.loading = false;
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
      right: 170px; /* offset left so it doesn't overlap the markers toolbar */
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

    .event-count {
      font-size: 11px;
      background: #e3f2fd;
      color: #1565c0;
      padding: 2px 6px;
      border-radius: 10px;
      margin-top: 8px;
      display: inline-block;
    }
  `;

  _subscribeBusEvents() {
    this._timelineListener = () => this._scheduleRender();
    this._selectionListener = () => {
      this._scheduleRender();
      this.requestUpdate();
    };
    this._eventsChangedListener = () => this.refresh();

    bus.on(TimelineEvents.MONTHS_CHANGED, this._timelineListener);
    bus.on(TimelineEvents.SCALE_CHANGED, this._timelineListener);
    bus.on(ProjectEvents.CHANGED, this._selectionListener);
    bus.on(PlanEventEvents.CHANGED, this._eventsChangedListener);
  }

  _unsubscribeBusEvents() {
    if (this._timelineListener) {
      bus.off(TimelineEvents.MONTHS_CHANGED, this._timelineListener);
      bus.off(TimelineEvents.SCALE_CHANGED, this._timelineListener);
    }
    if (this._selectionListener) {
      bus.off(ProjectEvents.CHANGED, this._selectionListener);
    }
    if (this._eventsChangedListener) {
      bus.off(PlanEventEvents.CHANGED, this._eventsChangedListener);
    }
  }

  updated(changedProperties) {
    if (changedProperties.has('events')) {
      this._renderSvg();
    }
  }

  render() {
    const count = this.events.length;
    return html`
      <div class="floating-toolbar">
        <button class="close-btn" @click=${() => this.close()}>✕</button>
        <div class="toolbar-title">Plan Events</div>
        <button @click=${() => this.refresh()}>
          ${this.loading ? 'Loading…' : 'Refresh'}
        </button>
        <span class="event-count">${count} event${count !== 1 ? 's' : ''}</span>
      </div>
    `;
  }

  async open() {
    super.open();
    await this.refresh();
  }

  async refresh() {
    this.loading = true;
    this.events = (await dataService.getEvents()) || [];
    this.loading = false;
    this._renderSvg();
    this.requestUpdate();
  }

  _renderSvg() {
    if (!this.visible || !this._svgEl) return;

    if (!this._svgEl.isConnected) {
      this._attachOverlay();
      if (!this._svgEl?.isConnected) return;
    }

    this._svgEl.innerHTML = '';

    if (!this.events.length) return;

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

    this._svgEl.setAttribute('width', boardRect.width);
    this._svgEl.setAttribute('height', boardRect.height);
    this._svgEl.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);
    this._svgEl.style.width = `${boardRect.width}px`;
    this._svgEl.style.height = `${boardRect.height}px`;

    // Filter events to selected plans only
    const selectedProjects = (state.projects || []).filter((p) => p.selected).map((p) => p.id);
    if (!selectedProjects.length) return;

    const filteredEvents = this.events.filter((ev) => selectedProjects.includes(ev.plan_id));

    // Resolve X positions, dropping events outside the visible timeline range
    const positioned = filteredEvents
      .map((ev) => {
        const x = this._calcX(new Date(ev.date), months, monthWidth);
        return x !== null ? { ev, x } : null;
      })
      .filter(Boolean);

    // Sort by X so overlap detection is straightforward
    positioned.sort((a, b) => a.x - b.x);

    // Track tag columns per X cluster for non-overlapping vertical stacking
    // xStack: array of {maxX, rows} where rows = count of tags in this cluster
    const xStack = [];

    positioned.forEach(({ ev, x }) => {
      // Find existing cluster within threshold
      let cluster = xStack.find((c) => Math.abs(c.maxX - x) < TAG_CLUSTER_THRESHOLD);
      if (!cluster) {
        cluster = { maxX: x, rows: 0 };
        xStack.push(cluster);
      }
      cluster.maxX = Math.max(cluster.maxX, x);
      const row = cluster.rows;
      cluster.rows++;

      this._createEventTag(x, ev, boardRect.height, boardCoords.scrollY, row);
    });
  }

  /**
   * Convert a date to board-space X. Returns null for dates outside the timeline range.
   * @param {Date} date
   * @param {Date[]} months
   * @param {number} monthWidth
   * @returns {number|null}
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

  /**
   * Draw a single event: vertical dashed line + tag anchored to bottom of board.
   * @param {number} x         Board-space X coordinate
   * @param {{id:string,date:string,title:string,plan_id:string}} ev
   * @param {number} boardHeight
   * @param {number} scrollY   Current vertical scroll of the board
   * @param {number} row       Stack row (0 = bottom-most, 1 = one above, …)
   */
  _createEventTag(x, ev, boardHeight, scrollY, row) {
    const color = '#1565c0';
    const tagHeight = 18;
    const tagPadding = 6;
    const label = ev.title.length > 16 ? ev.title.slice(0, 14) + '…' : ev.title;
    const labelWidth = label.length * 5.5;
    const tagWidth = labelWidth + tagPadding * 2;

    // Tags stick to the visible BOTTOM of the board area.
    // scrollY advances as the user scrolls down; the tag must move upward by scrollY
    // to stay at a fixed screen position near the bottom edge of the viewport.
    const bottomOffset = 5 + row * (tagHeight + 3);
    const tagY = boardHeight - (scrollY ?? 0) - tagHeight - bottomOffset;

    // Vertical dashed line
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', 0);
    line.setAttribute('x2', x);
    line.setAttribute('y2', boardHeight);
    line.setAttribute('stroke', color);
    line.setAttribute('opacity', '0.35');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '3,5');
    line.style.pointerEvents = 'none';
    this._svgEl.appendChild(line);

    // Tag group
    const tagGroup = document.createElementNS(SVG_NS, 'g');
    tagGroup.setAttribute('class', 'event-tag');
    tagGroup.style.cursor = 'default';
    tagGroup.style.pointerEvents = 'auto';

    const tagBg = document.createElementNS(SVG_NS, 'rect');
    tagBg.setAttribute('x', x - tagWidth / 2);
    tagBg.setAttribute('y', tagY);
    tagBg.setAttribute('width', tagWidth);
    tagBg.setAttribute('height', tagHeight);
    tagBg.setAttribute('fill', color);
    tagBg.setAttribute('rx', '3');
    tagBg.setAttribute('opacity', '0.85');
    tagGroup.appendChild(tagBg);

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
    const titleEl = document.createElementNS(SVG_NS, 'title');
    const plan = (state.projects || []).find((p) => p.id === ev.plan_id);
    const tooltipParts = [
      ev.title,
      plan ? `Plan: ${plan.name}` : '',
      `Date: ${ev.date}`,
    ].filter(Boolean);
    titleEl.textContent = tooltipParts.join('\n');
    tagGroup.appendChild(titleEl);

    this._svgEl.appendChild(tagGroup);
  }
}

customElements.define('plugin-events', PluginEventsComponent);
export default PluginEventsComponent;
