/**
 * PluginHistoryComponent - Displays task history as timeline overlay
 *
 * Shows start/end date and iteration changes for tasks as colored lines,
 * dots, and fish-bone connectors on the timeline board.
 */
import { LitElement, html, css } from '../vendor/lit.js';
import { TIMELINE_CONFIG, getTimelineMonths } from '../components/Timeline.lit.js';
import { bus } from '../core/EventBus.js';
import { TimelineEvents, ProjectEvents, TeamEvents } from '../core/EventRegistry.js';
import { getBoardOffset, findInBoard } from '../components/board-utils.js';
import { state } from '../services/State.js';
import { pluginManager } from '../core/PluginManager.js';
import { dataService } from '../services/dataService.js';

export class PluginHistoryComponent extends LitElement {
  static properties = {
    visible: { type: Boolean },
    historyData: { type: Array },
    loading: { type: Boolean },
    // Progress tracking for toolbox feedback
    totalPlans: { type: Number },
    currentPlanIndex: { type: Number },
    currentPlanId: { type: String },
    tasksInvestigated: { type: Number },
  };

  constructor() {
    super();
    this.visible = false;
    this.historyData = [];
    this.loading = false;
    this._svgEl = null;
    this._scrollScheduled = false;
    this._overlay = null;
    this._tooltipEl = null;
    this._loadedProjects = new Set(); // Track which projects have been loaded
    this.totalPlans = 0;
    this.currentPlanIndex = 0;
    this.currentPlanId = '';
    this.tasksInvestigated = 0;
  }

  async _ensureVisibleProjectsLoaded() {
    try {
      const board = findInBoard('feature-board');
      if (!board) return;
      const hostRoot = board.shadowRoot || board;
      const br = board.getBoundingClientRect();
      const visibleProjectIds = new Set();

      // Query likely card selectors
      const cards = hostRoot.querySelectorAll('feature-card, .card, feature-card-lit');
      for (const card of cards) {
        try {
          const crect = card.getBoundingClientRect ? card.getBoundingClientRect() : null;
          if (!crect) continue;
          if (crect.bottom < br.top || crect.top > br.bottom) continue; // not visible
          const ds = card.dataset || {};
          const maybe =
            ds.projectId || ds.planId || ds.project || ds['project_id'] || ds['plan_id'];
          if (maybe) visibleProjectIds.add(String(maybe));
        } catch (e) {
          /*ignore*/
        }
      }

      if (visibleProjectIds.size === 0) return;

      const selectedProjects = (state.projects || []).filter((p) => p.selected);
      const toFetch = selectedProjects.filter(
        (p) => visibleProjectIds.has(String(p.id)) && !this._loadedProjects.has(p.id)
      );
      if (toFetch.length === 0) return;
      console.log(
        `[PluginHistory] Lazy-loading history for visible projects: ${toFetch.map((p) => p.id).join(',')}`
      );
      // Initialize progress tracking for lazy load
      this.totalPlans = toFetch.length;
      this.currentPlanIndex = 0;
      this.currentPlanId = '';
      this.requestUpdate();

      const newTasks = [];
      for (const project of toFetch) {
        this.currentPlanIndex = (this.currentPlanIndex || 0) + 1;
        this.currentPlanId = project.id;
        this.requestUpdate();
        try {
          const data = await dataService.getHistory(project.id, {
            per_page: 500,
          });
          if (data && data.tasks && data.tasks.length) {
            newTasks.push(...data.tasks);
            this.tasksInvestigated = (this.tasksInvestigated || 0) + data.tasks.length;
          }
          this._loadedProjects.add(project.id);
        } catch (e) {
          console.error('[PluginHistory] Error lazy-loading project history', e);
        }
      }

      if (newTasks.length) {
        const existingIds = new Set(this.historyData.map((t) => t.task_id));
        const unique = newTasks.filter((t) => !existingIds.has(t.task_id));
        this.historyData = [...this.historyData, ...unique];
      }
      // clear lazy-load current indicator
      this.currentPlanId = '';
      this.requestUpdate();
    } catch (e) {
      console.error('[PluginHistory] _ensureVisibleProjectsLoaded error', e);
    }
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
      width: 300px;
      box-sizing: border-box;
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

    .task-count {
      font-size: 11px;
      background: #e3f2fd;
      color: #1565c0;
      padding: 2px 6px;
      border-radius: 10px;
      margin-top: 8px;
      display: inline-block;
    }

    .tooltip {
      position: fixed;
      pointer-events: none;
      background: #222;
      color: #fff;
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 13px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
      white-space: nowrap;
      z-index: 201;
      display: none;
    }

    .tooltip.visible {
      display: block;
    }

    .tooltip .label {
      opacity: 0.85;
      color: #ffd;
    }
  `;

  connectedCallback() {
    super.connectedCallback();

    this._timelineListener = () => {
      if (this.visible) {
        if (!this._scrollScheduled) {
          this._scrollScheduled = true;
          requestAnimationFrame(() => {
            this._scrollScheduled = false;
            // Ensure visible projects' history is loaded, then update
            this._ensureVisibleProjectsLoaded()
              .then(() => this._updateHistory())
              .catch(() => this._updateHistory());
          });
        }
      }
    };

    bus.on(TimelineEvents.MONTHS_CHANGED, this._timelineListener);
    bus.on(TimelineEvents.SCALE_CHANGED, this._timelineListener);

    // Listen for project/team selection changes - refetch data
    this._selectionListener = async () => {
      if (this.visible) {
        await this.refresh(); // Refetch data when project selection changes
        this.requestUpdate();
      }
    };

    bus.on(ProjectEvents.CHANGED, this._selectionListener);
    bus.on(TeamEvents.CHANGED, this._selectionListener);

    const board = findInBoard('feature-board');
    if (board) {
      this._scrollListener = () => {
        if (this.visible && !this._scrollScheduled) {
          this._scrollScheduled = true;
          requestAnimationFrame(() => {
            this._scrollScheduled = false;
            this._ensureVisibleProjectsLoaded()
              .then(() => this._updateHistory())
              .catch(() => this._updateHistory());
          });
        }
      };
      board.addEventListener('scroll', this._scrollListener);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    if (this._timelineListener) {
      bus.off(TimelineEvents.MONTHS_CHANGED, this._timelineListener);
      bus.off(TimelineEvents.SCALE_CHANGED, this._timelineListener);
    }

    if (this._selectionListener) {
      bus.off(ProjectEvents.CHANGED, this._selectionListener);
      bus.off(TeamEvents.CHANGED, this._selectionListener);
    }

    if (this._scrollListener) {
      const board = findInBoard('feature-board');
      board?.removeEventListener('scroll', this._scrollListener);
    }

    if (this._syncOverlayScroll) {
      const board = findInBoard('feature-board');
      board?.removeEventListener('scroll', this._syncOverlayScroll);
    }

    this._overlay?.remove();
    this._overlay = null;
    this._svgEl = null;
    this._tooltipEl?.remove();
    this._tooltipEl = null;
  }

  firstUpdated() {
    const board = findInBoard('feature-board');
    if (!board) return;

    const hostRoot = board.shadowRoot || board;
    let overlay = hostRoot.querySelector('.history-overlay-svg');

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'history-overlay-svg';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'history-svg');
      overlay.appendChild(svg);
      hostRoot.appendChild(overlay);

      Object.assign(overlay.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '5',
        overflow: 'hidden',
        display: 'block',
      });
    }

    this._overlay = overlay;
    this._svgEl = overlay.querySelector('.history-svg');

    // Create tooltip element in the shadow root of feature-board so it moves with the board
    if (!this._tooltipEl) {
      this._tooltipEl = document.createElement('div');
      this._tooltipEl.className = 'history-tooltip';

      // Inject tooltip styles directly on the element
      Object.assign(this._tooltipEl.style, {
        position: 'absolute',
        pointerEvents: 'none',
        background: '#222',
        color: '#fff',
        padding: '8px 10px',
        borderRadius: '6px',
        fontSize: '13px',
        boxShadow: '0 6px 18px rgba(0,0,0,.25)',
        whiteSpace: 'nowrap',
        zIndex: '201',
        display: 'none',
      });

      hostRoot.appendChild(this._tooltipEl);
    }

    // Keep overlay aligned with the viewport as the board scrolls
    // This allows us to render in viewport-space coordinates
    if (board && !this._syncOverlayScroll) {
      this._syncOverlayScroll = () => {
        if (this._overlay && board) {
          this._overlay.style.transform = `translateY(${board.scrollTop}px)`;
        }
      };
      board.addEventListener('scroll', this._syncOverlayScroll);
      this._syncOverlayScroll(); // Initial sync
    }

    if (this._svgEl) {
      Object.assign(this._svgEl.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
      });
    }
  }

  updated(changedProperties) {
    if (changedProperties.has('historyData') || changedProperties.has('visible')) {
      this._updateHistory();
    }
  }

  render() {
    const taskCount = this.historyData?.length || 0;
    const selectedProjects = (state.projects || []).filter((p) => p.selected);
    const projectCount = selectedProjects.length;

    return this.visible ?
        html`
          <div class="floating-toolbar">
            <button class="close-btn" @click="${this._handleClose}" title="Close">
              ×
            </button>
            <div class="toolbar-title">Task History</div>
            <button @click="${this.refreshCache}" ?disabled="${this.loading}">
              ${this.loading ? '⏳ Loading...' : '🔄 Refresh Cache'}
            </button>
            ${this.loading ?
              html`
                <div style="font-size:11px; margin-top:8px; color:#444;">
                  Investigating: <strong>${this.currentPlanId || '—'}</strong>
                </div>
                <div style="font-size:11px; margin-top:4px; color:#666;">
                  Plans left:
                  <strong
                    >${Math.max(
                      0,
                      (this.totalPlans || 0) - (this.currentPlanIndex || 0)
                    )}</strong
                  >
                  &nbsp;•&nbsp; Tasks checked:
                  <strong>${this.tasksInvestigated || 0}</strong>
                </div>
              `
            : ''}
            ${!this.loading && taskCount > 0 ?
              html`
                <div class="task-count">
                  ${taskCount} task${taskCount !== 1 ? 's' : ''} with history
                </div>
                <div
                  class="task-count"
                  style="font-size: 11px; margin-top: 4px; opacity: 0.8;"
                >
                  from ${projectCount} project${projectCount !== 1 ? 's' : ''}
                </div>
              `
            : ''}
            ${!this.loading && taskCount === 0 ?
              html`
                <div style="font-size: 11px; color: #999; margin-top: 8px;">
                  No history data available
                </div>
              `
            : ''}
          </div>
        `
      : '';
  }

  async open() {
    this.visible = true;
    this.setAttribute('visible', '');
    if (this._overlay) this._overlay.style.display = 'block';
    await this.refresh();
  }

  _handleClose() {
    // Call plugin.deactivate() which will call this.close()
    const plugin = pluginManager.get('plugin-history');
    if (plugin) plugin.deactivate();
  }

  close() {
    this.visible = false;
    this.removeAttribute('visible');
    if (this._overlay) this._overlay.style.display = 'none';
    if (this._tooltipEl) this._tooltipEl.style.display = 'none';
  }

  async refreshCache() {
    // Clear loaded projects cache and refetch everything with cache invalidation
    console.log('[PluginHistory] Refreshing cache - invalidating all cached history');
    this._loadedProjects.clear();
    this.historyData = [];
    await this.refresh(true); // Pass true to invalidate cache
  }

  async refresh(invalidateCache = false) {
    this.loading = true;
    try {
      // Get all selected projects
      const selectedProjects = (state.projects || []).filter((p) => p.selected);

      if (selectedProjects.length === 0) {
        console.warn('[PluginHistory] No project selected');
        this.historyData = [];
        this._loadedProjects.clear();
        return;
      }

      // Determine which projects need to be fetched
      const projectsToFetch =
        invalidateCache ?
          selectedProjects // Fetch all if invalidating cache
        : selectedProjects.filter((p) => !this._loadedProjects.has(p.id)); // Only new projects

      if (projectsToFetch.length === 0) {
        console.log('[PluginHistory] All selected projects already loaded');
        return;
      }

      console.log(
        `[PluginHistory] Fetching history for ${projectsToFetch.length} projects:`,
        projectsToFetch.map((p) => p.id)
      );
      // Initialize progress tracking
      this.totalPlans = projectsToFetch.length;
      this.currentPlanIndex = 0;
      this.currentPlanId = '';
      this.tasksInvestigated = 0;
      this.requestUpdate();

      // Fetch history from API for projects that need loading
      const newTasks = [];
      for (const project of projectsToFetch) {
        this.currentPlanIndex = (this.currentPlanIndex || 0) + 1;
        this.currentPlanId = project.id;
        this.requestUpdate();
        try {
          const data = await dataService.getHistory(project.id, {
            per_page: 500,
            invalidate_cache: !!invalidateCache,
          });
          if (data && data.tasks && data.tasks.length > 0) {
            newTasks.push(...data.tasks);
            this.tasksInvestigated += data.tasks.length;
            console.log(
              `[PluginHistory] Loaded ${data.tasks.length} tasks from ${project.id}`
            );
          }

          // Mark this project as loaded
          this._loadedProjects.add(project.id);
        } catch (err) {
          console.error(`[PluginHistory] Error fetching history for ${project.id}:`, err);
        }
      }

      // Merge new tasks with existing data
      if (invalidateCache) {
        // Replace all data when invalidating cache
        this.historyData = newTasks;
      } else {
        // Remove tasks from deselected projects
        const selectedProjectIds = new Set(selectedProjects.map((p) => p.id));
        this.historyData = this.historyData.filter((task) => {
          // Keep tasks that belong to selected projects
          // Note: task.plan_id might not directly match project.id, but we'll filter conservatively
          return true; // For now, keep existing tasks
        });

        // Remove deselected projects from loaded set
        for (const projectId of this._loadedProjects) {
          if (!selectedProjectIds.has(projectId)) {
            this._loadedProjects.delete(projectId);
          }
        }

        // Append new tasks to existing data
        // Remove duplicates based on task_id
        const existingIds = new Set(this.historyData.map((t) => t.task_id));
        const uniqueNewTasks = newTasks.filter((t) => !existingIds.has(t.task_id));
        this.historyData = [...this.historyData, ...uniqueNewTasks];
      }

      console.log(
        `[PluginHistory] Total loaded: ${this.historyData.length} tasks with history`
      );
      // clear progress indicators
      this.currentPlanId = '';
      this.currentPlanIndex = this.totalPlans || 0;
      this.requestUpdate();

      // Log summary of history data
      const tasksWithHistory = this.historyData.filter(
        (t) => t.history && t.history.length > 0
      );
      console.log(
        `[PluginHistory] Tasks with actual history entries: ${tasksWithHistory.length}`
      );
    } catch (err) {
      console.error('[PluginHistory] Failed to load history:', err);
      this.historyData = [];
    } finally {
      this.loading = false;
    }
  }

  _updateHistory() {
    if (!this.visible || !this._svgEl) return;

    // If SVG is not in DOM, reinitialize
    if (!this._svgEl.isConnected) {
      this.firstUpdated();
      if (!this._svgEl?.isConnected) return;
    }

    // Clear existing visualizations
    this._svgEl.innerHTML = '';

    if (!this.historyData?.length) return;

    const board = findInBoard('feature-board');
    if (!board) return;

    // Prefer LayoutManager-provided client rect (page coords) to avoid DOM reads
    let boardRect = null;
    try {
      if (
        board &&
        board._layout &&
        typeof board._layout.getBoardClientRect === 'function'
      ) {
        const brClient = board._layout.getBoardClientRect();
        if (brClient)
          boardRect = {
            left: brClient.left || 0,
            top: brClient.top || 0,
            width: brClient.width || board.clientWidth || 0,
            height: brClient.height || board.clientHeight || 0,
          };
      }
    } catch (e) {
      boardRect = null;
    }
    if (!boardRect) {
      try {
        const br = board.getBoundingClientRect();
        boardRect = {
          left: br.left,
          top: br.top,
          width: br.width,
          height: br.height,
        };
      } catch (e) {
        boardRect = {
          left: 0,
          top: 0,
          width: board.clientWidth || 0,
          height: board.clientHeight || 0,
        };
      }
    }
    const boardOffset = getBoardOffset() || 0;
    const monthWidth = TIMELINE_CONFIG.monthWidth || 120;
    const months = getTimelineMonths();

    if (!months?.length) return;

    // Size SVG to viewport
    this._svgEl.setAttribute('width', boardRect.width);
    this._svgEl.setAttribute('height', boardRect.height);
    this._svgEl.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);

    this._svgEl.style.width = `${boardRect.width}px`;
    this._svgEl.style.height = `${boardRect.height}px`;

    // Get scroll position for viewport-space calculations
    const scrollTop = board.scrollTop || 0;
    const viewportHeight = boardRect.height;

    // Process each task with history
    this.historyData.forEach((taskData) => {
      this._renderTaskHistory(
        taskData,
        months,
        monthWidth,
        boardOffset,
        scrollTop,
        viewportHeight
      );
    });
  }

  _renderTaskHistory(
    taskData,
    months,
    monthWidth,
    boardOffset,
    scrollTop,
    viewportHeight
  ) {
    const taskId = taskData.task_id;
    const history = taskData.history || [];

    if (!history.length) {
      console.debug(`[PluginHistory] Task ${taskId} has no history entries`);
      return;
    }

    // Find the card element for this task
    const board = findInBoard('feature-board');
    if (!board) {
      console.debug('[PluginHistory] Could not find feature-board element');
      return;
    }

    const hostRoot = board.shadowRoot || board;

    // Try different selectors to find the card
    let cardEl = hostRoot.querySelector(`[data-feature-id="${taskId}"]`);
    if (!cardEl) {
      cardEl = hostRoot.querySelector(`[data-id="${taskId}"]`);
    }
    if (!cardEl) {
      cardEl = hostRoot.querySelector(`[data-work-item-id="${taskId}"]`);
    }
    if (!cardEl) {
      cardEl = hostRoot.querySelector(`[data-task-id="${taskId}"]`);
    }
    if (!cardEl) {
      // Try finding by title as fallback
      const cards = hostRoot.querySelectorAll('feature-card, .card');
      for (const card of cards) {
        const titleEl = card.querySelector('.title, .card-title');
        if (titleEl && titleEl.textContent.includes(taskData.title)) {
          cardEl = card;
          break;
        }
      }
    }

    if (!cardEl) {
      console.debug(
        `[PluginHistory] Could not find card for task ${taskId} (${taskData.title})`
      );
      return;
    }

    console.debug(
      `[PluginHistory] Rendering ${history.length} history entries for task ${taskId}`
    );

    // Calculate card position - prefer LayoutManager geometry when available
    let cardY = 0;
    let cardHeight = 0;
    try {
      if (board && board._layout && typeof board._layout.getGeometry === 'function') {
        const geom = board._layout.getGeometry(taskId);
        if (geom) {
          cardY = geom.top;
          cardHeight = geom.height || geom.h || 0;
        }
      }
    } catch (e) {
      /* ignore */
    }

    if (!cardHeight) {
      try {
        // Prefer offsetTop/offsetHeight which are content coordinates relative to the board
        const host = cardEl;
        const offTop =
          typeof host.offsetTop === 'number' ? host.offsetTop
          : host.getBoundingClientRect ?
            host.getBoundingClientRect().top - (boardRect.top || 0)
          : 0;
        const offH =
          typeof host.offsetHeight === 'number' ? host.offsetHeight
          : host.getBoundingClientRect ? host.getBoundingClientRect().height
          : 0;
        cardY = offTop;
        cardHeight = offH;
        // Update LayoutManager so future renders can use cached geometry
        try {
          if (board && board._layout && typeof board._layout.setGeometry === 'function')
            board._layout.setGeometry(taskId, {
              left: host.offsetLeft || 0,
              top: offTop,
              width: host.offsetWidth || 0,
              height: offH,
            });
        } catch (e) {}
      } catch (e) {
        // fallback to defaults
        cardY = 0;
        cardHeight = 0;
      }
    }

    // Convert to viewport-space coordinates and check if visible
    const cardViewportY = cardY - scrollTop;

    // Skip cards that are completely outside the visible viewport
    if (cardViewportY + cardHeight < -50 || cardViewportY > viewportHeight + 50) {
      return; // Card is not visible, skip rendering
    }

    // Separate history by field type
    const startHistory = history.filter((h) => h.field === 'start');
    const endHistory = history.filter((h) => h.field === 'end');

    // Draw start history line (amber) - use viewport coordinates
    if (startHistory.length > 0) {
      const startY = cardViewportY + cardHeight * 0.33; // Upper third of card
      this._drawHistoryLine(
        startHistory,
        startY,
        '#ff9800',
        months,
        monthWidth,
        boardOffset,
        taskData.title,
        'start'
      );
    }

    // Draw end history line (green) - use viewport coordinates
    if (endHistory.length > 0) {
      const endY = cardViewportY + cardHeight * 0.67; // Lower third of card
      this._drawHistoryLine(
        endHistory,
        endY,
        '#4caf50',
        months,
        monthWidth,
        boardOffset,
        taskData.title,
        'end'
      );
    }

    // Draw fish-bone connectors for paired changes - use viewport coordinates
    this._drawFishboneConnectors(
      history,
      cardViewportY,
      cardHeight,
      months,
      monthWidth,
      boardOffset
    );
  }

  _drawHistoryLine(
    historyEntries,
    y,
    color,
    months,
    monthWidth,
    boardOffset,
    taskTitle,
    fieldType
  ) {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    console.debug(
      `[PluginHistory] Drawing ${fieldType} line with ${historyEntries.length} entries at y=${y}`
    );

    // Calculate x positions for all entries
    const points = historyEntries
      .map((entry, idx) => {
        const date = new Date(entry.value);
        const x = this._calcX(date, months, monthWidth, boardOffset);
        if (x === null) {
          console.debug(
            `[PluginHistory] Skipping ${fieldType} entry (out of timeline range):`,
            entry.value,
            date
          );
        }
        return x !== null ? { x, entry, idx } : null;
      })
      .filter((p) => p !== null);

    console.debug(
      `[PluginHistory] ${points.length}/${historyEntries.length} points are within timeline range`
    );

    if (points.length === 0) {
      console.debug(`[PluginHistory] No points in visible timeline for ${fieldType}`);
      return;
    }

    // Draw line connecting all points
    if (points.length > 1) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', points[0].x);
      line.setAttribute('y1', y);
      line.setAttribute('x2', points[points.length - 1].x);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '3');
      line.setAttribute('opacity', '0.95');
      line.style.pointerEvents = 'none';
      this._svgEl.appendChild(line);
    }

    // Draw dots for each change
    points.forEach(({ x, entry, idx }) => {
      const isFirst = idx === 0;
      const isLast = idx === historyEntries.length - 1;
      const isLarge = isFirst || isLast;
      const radius = isLarge ? 7 : 3;

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', radius);
      circle.setAttribute('fill', isLarge ? color : this._lightenColor(color));
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('stroke-width', '1');
      circle.setAttribute('tabindex', '0');
      circle.style.cursor = 'pointer';
      circle.style.pointerEvents = 'auto';

      // Add tooltip on hover/focus
      const showTooltip = (event) => {
        if (!this._tooltipEl) return;

        const tooltipContent = [
          `<strong>${taskTitle}</strong>`,
          `${fieldType === 'start' ? 'Start' : 'End'} date: ${entry.value}`,
          entry.changed_by ? `Changed by: ${entry.changed_by}` : '',
          entry.changed_at ? `Date: ${entry.changed_at.slice(0, 10)}` : '',
          isFirst ? '(original)'
          : isLast ? '(current)'
          : '',
        ]
          .filter(Boolean)
          .join('<br>');

        this._tooltipEl.innerHTML = tooltipContent;
        this._tooltipEl.style.display = 'block';

        // Position tooltip relative to the circle
        // The circle's cx/cy are in SVG coordinates, which are already relative to the overlay
        const cx = parseFloat(circle.getAttribute('cx'));
        const cy = parseFloat(circle.getAttribute('cy'));

        this._tooltipEl.style.left = `${cx}px`;
        this._tooltipEl.style.top = `${cy - 10}px`;
        this._tooltipEl.style.transform = 'translate(-50%, -100%)';
      };

      const hideTooltip = () => {
        if (this._tooltipEl) {
          this._tooltipEl.style.display = 'none';
        }
      };

      circle.addEventListener('mouseenter', showTooltip);
      circle.addEventListener('mouseleave', hideTooltip);
      circle.addEventListener('focus', showTooltip);
      circle.addEventListener('blur', hideTooltip);

      this._svgEl.appendChild(circle);
    });
  }

  _drawFishboneConnectors(history, cardY, cardHeight, months, monthWidth, boardOffset) {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // Group history by pair_id
    const pairMap = new Map();
    history.forEach((entry) => {
      if (entry.pair_id) {
        if (!pairMap.has(entry.pair_id)) {
          pairMap.set(entry.pair_id, []);
        }
        pairMap.get(entry.pair_id).push(entry);
      }
    });

    // Draw connectors for each pair
    pairMap.forEach((pair, pairId) => {
      const startEntry = pair.find((e) => e.field === 'start');
      const endEntry = pair.find((e) => e.field === 'end');

      if (!startEntry || !endEntry) return;

      // Check if both changes happened at the same time (within 1 second)
      const startChangedAt =
        startEntry.changed_at ? new Date(startEntry.changed_at) : null;
      const endChangedAt = endEntry.changed_at ? new Date(endEntry.changed_at) : null;

      if (!startChangedAt || !endChangedAt) return;

      const timeDiff = Math.abs(startChangedAt.getTime() - endChangedAt.getTime());
      const changedSimultaneously = timeDiff < 1000; // Within 1 second

      if (!changedSimultaneously) return;

      // Calculate X positions based on the actual date VALUES (where the circles are)
      const startX = this._calcX(
        new Date(startEntry.value),
        months,
        monthWidth,
        boardOffset
      );
      const endX = this._calcX(new Date(endEntry.value), months, monthWidth, boardOffset);

      if (startX === null || endX === null) return;

      const startY = cardY + cardHeight * 0.33;
      const endY = cardY + cardHeight * 0.67;
      const midY = cardY + cardHeight * 0.5;

      // Draw fishbone connector between the circles
      if (Math.abs(startX - endX) < 5) {
        // If very close, draw a straight vertical line
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', startX);
        line.setAttribute('y1', startY);
        line.setAttribute('x2', startX);
        line.setAttribute('y2', endY);
        line.setAttribute('stroke', '#78909c');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '4 2');
        line.setAttribute('opacity', '0.7');
        line.style.pointerEvents = 'none';
        this._svgEl.appendChild(line);
      } else {
        // Draw Z-shaped connector: vertical-horizontal-vertical
        const path = document.createElementNS(SVG_NS, 'path');
        const pathData = `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;
        path.setAttribute('d', pathData);
        path.setAttribute('stroke', '#78909c');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-dasharray', '4 2');
        path.setAttribute('opacity', '0.7');
        path.style.pointerEvents = 'none';
        this._svgEl.appendChild(path);
      }
    });
  }

  _calcX(date, months, monthWidth, boardOffset) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();

    const monthIndex = months.findIndex(
      (m) => m.getFullYear() === year && m.getMonth() === month
    );
    if (monthIndex === -1) return null;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayRatio = (day - 1) / daysInMonth;

    return boardOffset + monthIndex * monthWidth + dayRatio * monthWidth;
  }

  _lightenColor(color) {
    // Simple color lightening for intermediate dots
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);

    // Mix with white (increase brightness)
    const newR = Math.min(255, r + 40);
    const newG = Math.min(255, g + 40);
    const newB = Math.min(255, b + 40);

    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  }
}

customElements.define('plugin-history', PluginHistoryComponent);
export default PluginHistoryComponent;
