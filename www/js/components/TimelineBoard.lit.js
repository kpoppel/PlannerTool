/**
 * TimelineBoard.lit.js
 * Host component that wires together the timeline header, feature board, and all overlays.
 *
 * Layout (shadow DOM):
 *
 *  timeline-board
 *  ├── #maingraph-section         (static, no scroll)
 *  └── #scroll-container          (single overflow:auto — handles H + V panning)
 *      ├── timeline-lit            (position:sticky; top:0 — always on screen, scrolls H)
 *      └── #board-area             (position:relative — coordinate origin for all overlays)
 *          └── feature-board       (sized to full content)
 *
 * Plugin overlays (annotation-overlay, link-editor-overlay, etc.) are appended
 * into #board-area as position:absolute siblings by their respective plugins.
 *
 * Panning: single mousedown→mousemove→mouseup handler on #scroll-container.
 * BoardCoordinateService is initialised here and provides the canonical
 * coordinate transforms used by all overlays.
 */

import { LitElement, html, css } from '../vendor/lit.js';
import { cmd, sel } from '../application/imports.js';
import { StoreController } from '../core/StoreController.js';
import { boardCoords } from '../services/BoardCoordinateService.js';
import { bus } from '../core/EventBus.js';
import { UIEvents, TimelineEvents, BoardEvents } from '../core/EventRegistry.js';
import { calcTodayX, setBoardZoom } from './board-utils.js';
import { getIconTemplate } from '../services/IconService.js';
import { getTaskFilterPresentation, renderFilterDimensionIcon } from './sidebar/SidebarTaskFilters.lit.js';
import './TaskList.lit.js';

const BOARD_ZOOM_STEP = 0.1;
const MIN_BOARD_ZOOM = 0.5;
// Capped at natural size: board zoom only ever shrinks feature-board rows to
// fit more cards vertically, it never enlarges cards past their default size.
const MAX_BOARD_ZOOM = 1;

export class TimelineBoard extends LitElement {
  static properties = {
    boardZoom: { state: true },
    _taskLayout: { state: true },
    _query: { state: true },
    _searchStatus: { state: true },
    _resizeWidth: { state: true },
    _highlightedTask: { state: true },
  };

  // LitElement already uses an open shadow root by default — no need to
  // override createRenderRoot(). The static styles getter below is injected
  // automatically via Lit's adoptedStyleSheets mechanism.

  constructor() {
    super();
    this.boardZoom = 1;
    this._view = new StoreController(this, (state) => state.view.options);
    this._filterSelection = new StoreController(this, (state) => state.selection);
    this._taskLayout = { height: 0, rows: [], groups: [], swimlanes: [], searchFeatures: [] };
    this._query = '';
    this._searchStatus = { count: 0, index: 0 };
    this._resizeWidth = null;
    this._highlightedTask = '';
    this._isPanning = false;
    this._panStart = null;
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onProximityMove = this._onProximityMove.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();

    requestAnimationFrame(async () => {
      const scrollContainer = this.shadowRoot.querySelector('#scroll-container');
      const boardArea = this.shadowRoot.querySelector('#board-area');

      if (scrollContainer && boardArea) {
        boardCoords.init(scrollContainer, boardArea);
      }

      await import('./MainGraph.lit.js');
      const mod_t = await import('./Timeline.lit.js');

      // Ensure we register for MONTHS before initializing the timeline so
      // the initial MONTHS emission during initTimeline() isn't missed.
      this._onMonthsUpdated = () => this._positionTodayLine(mod_t.getTimelineMonths());
      bus.on(TimelineEvents.MONTHS, this._onMonthsUpdated);

      await mod_t.initTimeline();
      mod_t.ensureScrollToMonth();

      const mod_f = await import('./FeatureBoard.lit.js');
      await mod_f.initBoard();

      // Mount the singleton group context menu and wire up right-click handlers.
      const { GroupContextMenu } = await import('./GroupContextMenu.lit.js');
      GroupContextMenu.init();
      this._initGroupContextMenu(GroupContextMenu);

      // Position today-line once months are available, and re-position on scale changes
      this._enablePanning();
      this._initScrollButtons();
      document.addEventListener('mousemove', this._onProximityMove);
    });
  }

  disconnectedCallback() {
    this._cancelColumnResize();
    const scroll = this.shadowRoot.querySelector('#scroll-container');
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (scroll) scroll.removeEventListener('mousedown', this._onMouseDown);
    if (scroll && this._onBoardContextMenu) scroll.removeEventListener('contextmenu', this._onBoardContextMenu);
    if (this._boardArea && this._onGroupContextMenu) this._boardArea.removeEventListener('group-context-menu', this._onGroupContextMenu);
    if (this._boardArea && this._onFeatureContextMenu) this._boardArea.removeEventListener('feature-context-menu', this._onFeatureContextMenu);
    if (this._onGroupMenuClosed) document.removeEventListener('group-menu-closed', this._onGroupMenuClosed);
    if (this._onGroupMenuCaret) document.removeEventListener('group-menu-caret', this._onGroupMenuCaret);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('mousemove', this._onProximityMove);
    if (this._onDetailsShow) bus.off(UIEvents.DETAILS_SHOW, this._onDetailsShow);
    if (this._onDetailsHide) bus.off(UIEvents.DETAILS_HIDE, this._onDetailsHide);
    if (this._onMonthsUpdated) bus.off(TimelineEvents.MONTHS, this._onMonthsUpdated);
    super.disconnectedCallback();
  }

  // ---------------------------------------------------------------------------
  // Group context menu wiring
  // ---------------------------------------------------------------------------

  _initGroupContextMenu(GroupContextMenu) {
    const scroll = this.shadowRoot.querySelector('#scroll-container');
    const boardArea = this.shadowRoot.querySelector('#board-area');
    this._boardArea = boardArea;

    // Right-click on the board background (not on a feature card or group pill)
    this._onBoardContextMenu = (e) => {
      // feature-card-lit and feature-group both call e.preventDefault() in their
      // own contextmenu handlers.  Event retargeting at shadow-DOM boundaries means
      // e.target is the shadow-host (feature-board), not the inner element, so
      // closest() checks are unreliable here.  Checking defaultPrevented is the
      // correct way to detect that an inner handler already claimed this event.
      if (e.defaultPrevented) return;
      e.preventDefault();
      if (!sel.scenario.isActiveScenarioMutable()) return;
      const selectedPlans = sel.selection.getSelectedProjects();
      const board = this.shadowRoot.querySelector('feature-board');
      const insertion = board.getInsertionSlotAt(e.clientY);
      const planId = insertion.planId !== null
        ? insertion.planId
        : selectedPlans.length === 1 ? selectedPlans[0].id : null;
      board.showInsertionCaret(insertion.caretTop, insertion.parentId);
      GroupContextMenu.show({
        type: 'board',
        planId,
        insertion,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    };
    if (scroll) scroll.addEventListener('contextmenu', this._onBoardContextMenu);

    // Clear the insertion caret once the menu closes (saved, cancelled or dismissed).
    this._onGroupMenuClosed = () => {
      const board = this.shadowRoot.querySelector('feature-board');
      if (board) board.clearInsertionCaret();
    };
    document.addEventListener('group-menu-closed', this._onGroupMenuClosed);

    // Menu entries move the caret so the user sees where each placement lands.
    this._onGroupMenuCaret = (e) => {
      const board = this.shadowRoot.querySelector('feature-board');
      if (board) board.showInsertionCaret(e.detail.caretTop, e.detail.nestGroupId);
    };
    document.addEventListener('group-menu-caret', this._onGroupMenuCaret);

    // group-context-menu bubbles up from FeatureBoard (right-click on group pill)
    this._onGroupContextMenu = (e) => {
      e.stopPropagation();
      GroupContextMenu.show({
        type: 'group',
        group: e.detail.group,
        clientX: e.detail.clientX,
        clientY: e.detail.clientY,
      });
    };
    if (boardArea) boardArea.addEventListener('group-context-menu', this._onGroupContextMenu);

    // feature-context-menu bubbles up from FeatureCard (right-click on a feature card)
    this._onFeatureContextMenu = (e) => {
      e.stopPropagation();
      GroupContextMenu.show({
        type: 'feature',
        feature: e.detail.feature,
        clientX: e.detail.clientX,
        clientY: e.detail.clientY,
      });
    };
    if (boardArea) boardArea.addEventListener('feature-context-menu', this._onFeatureContextMenu);
  }

  _positionTodayLine(months) {
    const line = this.shadowRoot.querySelector('#today-line');
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (!line) return;
    const x = calcTodayX(months);
    if (x === null) {
      line.style.display = 'none';
    } else {
      line.style.left = `${x}px`;
      line.style.display = 'block';
    }
  }

  // ---------------------------------------------------------------------------
  // Panning
  // ---------------------------------------------------------------------------

  _enablePanning() {
    const scroll = this.shadowRoot.querySelector('#scroll-container');
    if (!scroll) return;
    scroll.addEventListener('mousedown', this._onMouseDown);
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    if (!boardCoords.panningAllowed) return;
    const path = e.composedPath ? e.composedPath() : [];
    const startedInsideCardOrGroup = path.some((node) => {
      if (!(node instanceof HTMLElement)) return false;
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      if (tag === 'feature-card-lit' || tag === 'feature-group') return true;
      return node.classList.contains('drag-handle');
    });
    if (startedInsideCardOrGroup) return;
    const scroll = this.shadowRoot.querySelector('#scroll-container');
    if (!scroll) return;
    this._isPanning = true;
    this._panStart = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: scroll.scrollLeft,
      scrollTop: scroll.scrollTop,
    };
    scroll.classList.add('panning');
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
  }

  _onMouseMove(e) {
    if (!this._isPanning || !this._panStart) return;
    const scroll = this.shadowRoot.querySelector('#scroll-container');
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (!scroll) return;
    const dx = e.clientX - this._panStart.x;
    const dy = e.clientY - this._panStart.y;
    scroll.scrollLeft = this._panStart.scrollLeft - dx;
    scroll.scrollTop = this._panStart.scrollTop - dy;
  }

  _onMouseUp() {
    this._isPanning = false;
    this._panStart = null;
    const scroll = this.shadowRoot.querySelector('#scroll-container');
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (scroll) scroll.classList.remove('panning');
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
  }

  // ---------------------------------------------------------------------------
  // Scroll buttons
  // ---------------------------------------------------------------------------

  _initScrollButtons() {
    const scroll = this.shadowRoot.querySelector('#scroll-container');
    const btnTop = this.shadowRoot.querySelector('#btn-scroll-top');
    const btnBottom = this.shadowRoot.querySelector('#btn-scroll-bottom');

    if (btnTop)
      btnTop.addEventListener('click', () =>
        scroll.scrollTo({ top: 0, behavior: 'smooth' })
      );
    if (btnBottom)
      btnBottom.addEventListener('click', () =>
        scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' })
      );

    const scrollButtons = this.shadowRoot.querySelector('#scroll-buttons');
    this._onDetailsShow = () => { if (scrollButtons) scrollButtons.style.display = 'none'; };
    this._onDetailsHide = () => { if (scrollButtons) scrollButtons.style.display = ''; };
    bus.on(UIEvents.DETAILS_SHOW, this._onDetailsShow);
    bus.on(UIEvents.DETAILS_HIDE, this._onDetailsHide);
  }

  _onProximityMove(e) {
    const scrollButtons = this.shadowRoot.querySelector('#scroll-buttons');
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (!scrollButtons) return;
    const nearEdge = window.innerWidth - e.clientX <= 60;
    scrollButtons.classList.toggle('visible', nearEdge);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------


  scrollTo(x, y) {
    const scroll = this.shadowRoot.querySelector('#scroll-container');
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (scroll) scroll.scrollTo(x, y);
  }

  updated() {
    const options = this._view.value;
    const width = this._getTaskColumnWidth();
    this.style.setProperty('--task-column-width', `${width}px`);
    if (this._appliedColumnWidth !== undefined && this._appliedColumnWidth !== width &&
      options.timelineScale === 'threeMonths') bus.emit(TimelineEvents.SCALE_CHANGED);
    this._appliedColumnWidth = width;
  }

  _getTaskColumnWidth() {
    const options = this._view.value;
    if (options.displayMode === 'packed') return 0;
    if (this._resizeWidth !== null) return this._resizeWidth < 180 ? 8 : Math.max(200, this._resizeWidth);
    return options.taskColumnCollapsed ? 8 : options.taskColumnWidth;
  }

  _navigateTask(event) {
    this.shadowRoot.querySelector('feature-board').centerFeatureById(event.detail.id,
      { align: event.detail.align === 'start' ? 'start' : 'center' });
  }

  _highlightTask(event) {
    this._highlightedTask = event.detail.id;
    for (const card of this.shadowRoot.querySelector('feature-board').shadowRoot.querySelectorAll('feature-card-lit')) {
      card.classList.toggle('task-highlighted', String(card.feature.id) === event.detail.id);
    }
  }

  _cancelColumnResize() {
    window.removeEventListener('pointermove', this._onColumnMove);
    window.removeEventListener('pointerup', this._onColumnUp);
    window.removeEventListener('pointercancel', this._onColumnCancel);
    window.removeEventListener('keydown', this._onColumnKey);
    this._resizeWidth = null;
  }

  _startColumnResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = this._getTaskColumnWidth();
    this._resizeWidth = startWidth;
    this._onColumnMove = (move) => {
      this._resizeWidth = Math.max(0, Math.min(600, startWidth + move.clientX - startX));
    };
    this._onColumnUp = () => {
      if (this._resizeWidth >= 180) cmd.view.setTaskColumnWidth(Math.max(200, this._resizeWidth));
      cmd.view.setTaskColumnCollapsed(this._resizeWidth < 180);
      this._cancelColumnResize();
    };
    this._onColumnKey = (key) => {
      if (key.key === 'Escape') this._cancelColumnResize();
    };
    this._onColumnCancel = () => this._cancelColumnResize();
    window.addEventListener('pointermove', this._onColumnMove);
    window.addEventListener('pointerup', this._onColumnUp);
    window.addEventListener('pointercancel', this._onColumnCancel);
    window.addEventListener('keydown', this._onColumnKey);
  }

  _resizeColumnByKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = this._view.value;
    if (event.key === 'Home' || (event.key === 'ArrowLeft' &&
      (options.taskColumnCollapsed || options.taskColumnWidth <= 200))) {
      cmd.view.setTaskColumnCollapsed(true);
      return;
    }
    const width = event.key === 'End' ? 600 : options.taskColumnCollapsed
      ? options.taskColumnWidth : options.taskColumnWidth + (event.key === 'ArrowRight' ? 20 : -20);
    cmd.view.setTaskColumnWidth(Math.max(200, Math.min(600, width)));
    cmd.view.setTaskColumnCollapsed(false);
  }

  adjustBoardZoom(direction, anchorClientY) {
    const nextZoom = this.boardZoom + direction * BOARD_ZOOM_STEP;
    const boundedZoom = Math.max(MIN_BOARD_ZOOM, Math.min(MAX_BOARD_ZOOM, nextZoom));
    this._setBoardZoom(
      Math.round(boundedZoom * 10) / 10,
      anchorClientY
    );
  }

  resetBoardZoom() {
    this._setBoardZoom(1);
  }

  _setBoardZoom(nextZoom, anchorClientY) {
    if (nextZoom === this.boardZoom) return;
    if (!this.shadowRoot) {
      setBoardZoom(nextZoom);
      bus.emit(BoardEvents.ZOOM_CHANGED);
      this.boardZoom = nextZoom;
      return;
    }

    const scrollContainer = this.shadowRoot.querySelector('#scroll-container');
    if (!scrollContainer) {
      setBoardZoom(nextZoom);
      bus.emit(BoardEvents.ZOOM_CHANGED);
      this.boardZoom = nextZoom;
      return;
    }

    const previousZoom = this.boardZoom;
    const scrollRect = scrollContainer.getBoundingClientRect();
    // Board zoom only affects the vertical axis now, so only the Y anchor needs preserving.
    let pointerOffsetY = scrollContainer.clientHeight / 2;
    if (Number.isFinite(anchorClientY)) {
      pointerOffsetY = Math.max(
        0,
        Math.min(scrollContainer.clientHeight, anchorClientY - scrollRect.top)
      );
    }
    const anchoredContentY =
      (scrollContainer.scrollTop + pointerOffsetY) / previousZoom;

    // Row heights (laneHeight()) live outside this component so FeatureBoard's
    // absolute-positioned layout can read them without a prop-drilled dependency.
    setBoardZoom(nextZoom);
    bus.emit(BoardEvents.ZOOM_CHANGED);
    this.boardZoom = nextZoom;
    this.updateComplete.then(() => {
      scrollContainer.scrollTop = anchoredContentY * nextZoom - pointerOffsetY;
    });
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  static get styles() {
    return css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
      }

      .board-overview {
        display: grid;
        height: 120px;
        grid-template-rows: 120px;
        grid-template-columns: var(--task-column-width, 300px) minmax(0, 1fr);
        flex: 0 0 auto;
        min-width: 0;
      }

      #maingraph-section {
        grid-column: 2;
        grid-row: 1;
        flex: 0 0 auto;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
      }

      /* Single overflow container for H + V scroll / panning */
      #scroll-container {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        position: relative;
        cursor: grab;
        background: var(--app-background, #fff);
        display: grid;
        grid-template-columns: var(--task-column-width, 300px) max-content var(--task-navigation-tail, 0px);
        grid-template-rows: auto 1fr;
        align-content: start;
      }

      .task-toolbar { grid-column: 1; grid-row: 1;
        background: var(--color-bg, #f7f7f7); display: grid;
        grid-template-rows: repeat(5, 20px); gap: 3px; padding: 4px 6px; min-width: 0;
        height: 120px; min-height: 0; overflow: hidden;
        container-type: inline-size;
        box-sizing: border-box; border-right: 1px solid #bec8d2;
        cursor: default; }
      .task-search, .filter-markers {
        display: flex; align-items: center; gap: 6px; min-width: 0; }
      .filter-markers { overflow-x: auto; height: 20px; scrollbar-width: none; }
      .filter-markers::-webkit-scrollbar { display: none; }
      .filter-marker { display: inline-flex; align-items: center; justify-content: center;
        width: 14px; height: 14px; }
      .filter-marker svg { width: 16px; height: 16px; }
      .filter-overview-title { display: flex; align-items: center; justify-content: space-between; }
      .filter-overview-title h2 { margin: 0; font-size: 11px; line-height: 14px; font-weight: 600; }
      .compact-label { display: none; }
      @container (max-width: 240px) {
        .wide-label { display: none; }
        .compact-label { display: inline; }
      }
      .advanced-controls { display: flex; align-items: center; gap: 2px; min-width: 0; }
      .task-toolbar .advanced-open { flex: 0 0 auto; width: auto; height: 18px;
        padding: 0 3px; font-size: 10px; white-space: nowrap; }
      .task-toolbar .advanced-filter { flex: 0 0 16px; width: 16px; height: 18px;
        display: flex; align-items: center; justify-content: center; border: 1px solid transparent;
        border-radius: 2px; color: #64727f; }
      .advanced-filter svg { width: 12px; height: 12px; }
      .task-toolbar .advanced-filter[data-selection="some"] { background: #e0f1ee;
        color: #096b65; border-color: #75b8ad; }
      .task-toolbar .advanced-filter[data-selection="none"] { background: #fbe9e9;
        color: #aa3434; border-color: #dba3a3; }
      .focus-mode { display: grid; grid-template-columns: 1fr 1fr; gap: 2px;
        background: #e5e9ec; border-radius: 3px; padding: 1px; min-width: 0; }
      .task-toolbar .focus-mode button { width: auto; height: 18px; font-size: 11px;
        border-radius: 2px; }
      .task-toolbar .focus-mode button[aria-pressed="true"] { background: #fff;
        box-shadow: 0 0 0 1px #b6c3cd; font-weight: 600; }
      .task-toolbar .focus-mode button[data-team-focus="true"][aria-pressed="true"] {
        color: #096b65; box-shadow: 0 0 0 1px #75b8ad; }
      .task-toolbar .team-choice { flex: 0 0 auto; width: auto; max-width: 84px; height: 18px;
        display: inline-flex; align-items: center; gap: 4px; padding: 0 4px;
        border: 1px dashed #98a4af; border-radius: 3px; font-size: 10px; opacity: .6; }
      .task-toolbar .team-choice[aria-pressed="true"] { opacity: 1;
        border: 1px solid #197c76; background: #e0f1ee; }
      .team-choice .team-color { width: 6px; height: 10px; flex: 0 0 6px; border-radius: 1px; }
      .team-choice .team-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      .task-toolbar .filter-summary { width: 100%; height: 20px;
        display: flex; align-items: center; gap: 4px; padding: 0; border-radius: 3px;
        text-align: left; min-width: 0; }
      .task-toolbar .filter-summary-label { flex: 0 0 42px; width: 42px; height: 18px;
        text-align: left; font-size: 10px; color: #526170; }
      .filter-summary .filter-markers { flex: 1; }
      .filter-summary-count { flex: 0 0 auto; font-size: 10px; color: #526170;
        font-variant-numeric: tabular-nums; }
      .task-toolbar button:hover:not(:disabled) { background-color: #e4eaf0; }
      .task-toolbar button:focus-visible { outline: 2px solid #347ab3; outline-offset: 1px; }
      .task-toolbar .filter-choice { position: relative; flex: 0 0 18px; width: 18px; height: 18px;
        display: inline-flex; align-items: center; justify-content: center; padding: 1px;
        border: 1px dashed #98a4af; border-radius: 3px; box-sizing: border-box; opacity: .55; }
      .task-toolbar .filter-choice[aria-pressed="true"] { opacity: 1; border: 1px solid #197c76;
        box-shadow: inset 0 -2px #197c76; background: #e0f1ee; }
      .filter-empty { font-size: 10px; color: #aa3434; }
      .task-column-heading { grid-column: 1; grid-row: 1; position: sticky; top: 0; left: 0;
        z-index: 150; padding: 2px 8px; font-size: 11px; line-height: 16px;
        display: flex; align-items: center; gap: 6px; min-width: 0;
        background: var(--color-bg, #f7f7f7); border-right: 1px solid #bec8d2;
        box-sizing: border-box; }
      .task-column-title { flex: 0 0 auto; }
      .task-search { flex: 1; gap: 2px; }
      .task-search input { min-width: 0; width: 100%; height: 22px; padding: 2px 5px; box-sizing: border-box;
        border: 1px solid #bec8d2; border-radius: 4px; font: inherit; }
      .task-toolbar button { flex: 0 0 24px; width: 24px; height: 26px; padding: 0;
        border: 0; background: transparent; cursor: pointer; color: #23344d; }
      .task-toolbar button:disabled { opacity: .4; cursor: default; }
      .task-search button { flex: 0 0 16px; width: 16px; height: 20px; border: 0;
        padding: 0; background: transparent; color: #23344d; cursor: pointer; }
      .task-search button:disabled { opacity: .4; cursor: default; }
      .task-search output { font-size: 10px; white-space: nowrap; }
      .column-resizer { grid-column: 1; grid-row: 1 / 3; position: sticky;
        left: calc(var(--task-column-width, 300px) - 8px); top: 0; width: 8px;
        justify-self: end; align-self: stretch; z-index: 160; background: #bec8d255;
        cursor: col-resize; touch-action: none; }
      .column-resizer:hover, .column-resizer:focus-visible { background: #347ab3; }
      task-list { grid-column: 1; grid-row: 2; }
      [hidden] { display: none !important; }

      #scroll-container.panning {
        cursor: grabbing;
      }

      #scroll-container::-webkit-scrollbar {
        width: 8px;
        height: 8px;
        background: #eee;
      }
      #scroll-container::-webkit-scrollbar-thumb {
        background: #b0cbe6;
        border-radius: 4px;
      }

      /* Timeline header sticks vertically, scrolls horizontally with content.
        Cards scrolling past the header clip beneath it.
         Timeline never reacts to board zoom (X-axis only, like the graph);
         only #board-area (feature-board's cards) receives --board-zoom. */
      timeline-lit {
        grid-column: 2;
        grid-row: 1;
        position: sticky;
        top: 0;
        z-index: 130;
        display: block;
      }

      /*
       * Board area — positioned so overlays can use position:absolute with inset:0.
       * Background stripes are on this element because its width == content width,
       * keeping stripe alignment locked to month positions regardless of scroll.
       * --board-zoom scales feature-card row height (via laneHeight()) and font
       * size only; it never touches width, which stays owned by the timeline scale.
       */
      #board-area {
        grid-column: 2;
        grid-row: 2;
        position: relative;
        /* Ensure the board background (stripes) fills the visible viewport
           even when there are few or no feature cards. */
        min-height: 100vh;
        /* feature-board sets an explicit width matching the full logical
           timeline extent (see FeatureBoard.renderFeatures); grow to fit it
           instead of shrinking to the virtualized (viewport-only) subset of
           cards actually in the DOM, which would clip the stripe/swimlane
           backgrounds at the edge of the virtualization window. */
        width: fit-content;
        min-width: 100%;
        background: repeating-linear-gradient(
          to right,
          var(--color-bg, #f7f7f7) 0,
          var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
          var(--color-month-alt, #ececec) var(--timeline-month-width, 120px),
          var(--color-month-alt, #ececec) calc(var(--timeline-month-width, 120px) * 2)
        );
        background-position: 0 0;
      }

      #board-area.scenario-mode {
        background: repeating-linear-gradient(
          to right,
          var(--color-bg, #f7f7f7) 0,
          var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
          var(--color-month-alt-scenario, #e2e2e2) var(--timeline-month-width, 120px),
          var(--color-month-alt-scenario, #e2e2e2)
            calc(var(--timeline-month-width, 120px) * 2)
        );
        background-position: 0 0;
      }

      /* Vertical line marking today on the feature board */
      #today-line {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: rgba(255, 59, 48, 0.7);
        pointer-events: none;
        z-index: 10;
        display: none;
      }

      #today-line::before {
        content: 'Today';
        position: absolute;
        top: 4px;
        left: 4px;
        font-size: 10px;
        font-weight: 600;
        color: rgba(255, 59, 48, 0.85);
        white-space: nowrap;
        pointer-events: none;
      }

      /* Scroll-to-top / scroll-to-bottom buttons */
      #scroll-buttons {
        position: fixed;
        right: 20px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 30;
        opacity: 0;
        transition: opacity 180ms ease;
        pointer-events: none;
      }

      #scroll-buttons.visible {
        opacity: 1;
        pointer-events: auto;
      }

      .scroll-btn {
        width: 36px;
        height: 36px;
        border-radius: 18px;
        border: 1px solid rgba(0, 0, 0, 0.08);
        background: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
        transition: transform 120ms ease, background 120ms ease;
      }

      .scroll-btn:hover {
        transform: translateY(-2px);
        background: #fff;
      }

      .scroll-btn:active {
        transform: translateY(0);
      }
    `;
  }

  // ---------------------------------------------------------------------------
  // Template
  // ---------------------------------------------------------------------------

  _openFilterMenu(event, group) {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent('task-filter-menu-open', {
      bubbles: true, composed: true, detail: { group, trigger: event.currentTarget },
    }));
  }

  _toggleTeamFocus(team) {
    cmd.selection.setTeamSelected(team.id, !team.selected, { displayOnly: true });
    cmd.view.setTaskViewMode('team');
  }

  render() {
    const options = this._view.value;
    const packed = options.displayMode === 'packed';
    const columnWidth = this._getTaskColumnWidth();
    const collapsed = columnWidth === 8;
    const filters = getTaskFilterPresentation();
    const selectedTypes = filters.types.filter((type) => type.active);
    const selectedStates = filters.states.filter((state) => state.active);
    const contextTeamIds = new Set(sel.scope.getContextTeams().map((id) => String(id)));
    const teams = sel.selection.getTeams().filter((team) => contextTeamIds.has(String(team.id)));
    const selectedTeams = teams.filter((team) => team.selected);
    const teamFocus = sel.view.getTaskViewMode() === 'team';
    const restrictedFilters = filters.dimensions.filter((dimension) =>
      dimension.options.some((option) => !option.active)).length;
    return html`
      <div class="board-overview">
        <section id="maingraph-section" aria-label="Organisational Load Graph">
          <maingraph-lit></maingraph-lit>
        </section>
        <div class="task-toolbar" ?hidden=${packed || collapsed} @mousedown=${(event) => event.stopPropagation()}>
          ${collapsed ? '' : html`
            <div class="filter-overview-title">
              <h2 aria-label="View context"><span class="wide-label">View context</span><span class="compact-label">Context</span></h2>
              <div class="advanced-controls" role="group" aria-label="Advanced filters">
                <button class="advanced-open" aria-label="Advanced filters" aria-haspopup="dialog"
                  title=${`${restrictedFilters} restricted advanced filters`}
                  @click=${(event) => this._openFilterMenu(event, 'schedule')}>
                  <span class="wide-label">Advanced</span><span class="compact-label" aria-hidden="true">&#8230;</span>${restrictedFilters > 0 ? ` (${restrictedFilters})` : ''}</button>
                ${filters.dimensions.map((dimension) => {
                  const active = dimension.options.filter((option) => option.active);
                  const label = `${dimension.title}: ${active.length === 0 ? 'None' : active.map((option) => option.label).join(', ')}`;
                  return html`<button class="advanced-filter" data-filter-dimension=${dimension.key}
                    data-selection=${active.length === 0 ? 'none' : active.length === dimension.options.length ? 'all' : 'some'}
                    title=${label} aria-label=${label} ?disabled=${dimension.options.every((option) => option.disabled)}
                    @click=${() => cmd.filter.cycleTaskFilter(dimension.key)}>
                    ${renderFilterDimensionIcon(dimension.key)}</button>`;
                })}
              </div>
            </div>
            <div class="focus-mode" role="group" aria-label="Work shown">
              <button aria-pressed=${!teamFocus} title="Show all scoped plan work"
                @click=${() => cmd.view.setTaskViewMode('plan')}>Plan</button>
              <button aria-pressed=${teamFocus} data-team-focus="true" ?disabled=${teams.length === 0}
                title="Show selected teams in their full work context"
                @click=${() => cmd.view.setTaskViewMode('team')}>Team focus</button>
            </div>
            <div class="filter-summary">
              <button class="filter-summary-label" aria-label="Team drill-down" title="Open team drill-down"
                aria-haspopup="dialog" @click=${(event) => this._openFilterMenu(event, 'teams')}>Teams</button>
              <span class="filter-markers" role="group" aria-label="Team choices">
                ${teams.map((team) => html`<button class="team-choice" aria-label=${team.name}
                  title=${`${team.name}: ${team.selected ? 'selected' : 'not selected'}`}
                  aria-pressed=${team.selected} @click=${() => this._toggleTeamFocus(team)}>
                  <span class="team-color" style="background:${team.color}"></span>
                  <span class="team-name">${team.short ? team.short : team.name}</span></button>`)}
                ${teams.length === 0 ? html`<span class="filter-empty">No teams</span>` : ''}
              </span>
              <span class="filter-summary-count">${selectedTeams.length}/${teams.length}</span>
            </div>
            <div class="filter-summary">
              <button class="filter-summary-label" aria-label="Task types" title="Open task type filters"
                aria-haspopup="dialog" @click=${(event) => this._openFilterMenu(event, 'types')}>Types</button>
              <span class="filter-markers" role="group" aria-label="Selected task types">
              ${filters.types.map((type) => html`<button class="filter-choice" data-filter-type=${type.key}
                aria-label=${type.name} title=${`${type.name}: ${type.active ? 'shown' : 'hidden'}`}
                aria-pressed=${type.active} ?disabled=${type.disabled}
                @click=${() => cmd.filter.setTaskTypeSelected(type.key, !type.active)}>
                <span class="filter-marker">${getIconTemplate(type.name)}</span></button>`)}
              </span>
              <span class="filter-summary-count">${selectedTypes.length}/${filters.types.length}</span>
            </div>
            <div class="filter-summary">
              <button class="filter-summary-label" aria-label="States" title="Open state filters"
                aria-haspopup="dialog" @click=${(event) => this._openFilterMenu(event, 'states')}>States</button>
              <span class="filter-markers" role="group" aria-label="Selected states">
                ${filters.states.map((state) => html`<button class="filter-choice filter-state" data-filter-state=${state.name}
                  aria-label=${state.name} title=${`${state.name}: ${state.active ? 'shown' : 'hidden'}`}
                  style="background:${state.color}" aria-pressed=${state.active} ?disabled=${state.disabled}
                  @click=${() => cmd.filter.toggleStateSelected(state.name)}></button>`)}
              </span>
              <span class="filter-summary-count">${selectedStates.length}/${filters.states.length}</span>
            </div>
            `}
        </div>
      </div>

      <div id="scroll-container">
        <div class="task-column-heading" ?hidden=${packed || collapsed} @mousedown=${(event) => event.stopPropagation()}>
          <span class="task-column-title">Tasks</span>
          <div class="task-search">
            <input type="search" aria-label="Search tasks" placeholder="Search tasks" .value=${this._query}
              @input=${(event) => { this._query = event.target.value; }}
              @keydown=${(event) => {
                if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  this.shadowRoot.querySelector('task-list').navigateMatch(event.key === 'ArrowUp' || event.shiftKey ? -1 : 1);
                } else if (event.key === 'Escape') { event.stopPropagation(); this._query = ''; }
              }}>
            <output aria-live="polite">${this._query.trim() === '' ? '' : `${this._searchStatus.index}/${this._searchStatus.count}`}</output>
            <button title="Previous matching task" aria-label="Previous matching task" ?disabled=${this._searchStatus.count === 0}
              @click=${() => this.shadowRoot.querySelector('task-list').navigateMatch(-1)}>&#8593;</button>
            <button title="Next matching task" aria-label="Next matching task" ?disabled=${this._searchStatus.count === 0}
              @click=${() => this.shadowRoot.querySelector('task-list').navigateMatch(1)}>&#8595;</button>
            </div>
        </div>
        <div class="column-resizer" ?hidden=${packed} role="separator" tabindex="0" aria-label="Task column width"
          aria-orientation="vertical" aria-valuemin="8" aria-valuemax="600" aria-valuenow=${columnWidth}
          @mousedown=${(event) => event.stopPropagation()}
          @pointerdown=${this._startColumnResize} @keydown=${this._resizeColumnByKey}></div>
        <timeline-lit></timeline-lit>
        <task-list .layout=${this._taskLayout} .query=${this._query} .highlightedId=${this._highlightedTask}
          style="--board-zoom: ${this.boardZoom}" ?hidden=${packed || collapsed}
          @search-status-changed=${(event) => { this._searchStatus = event.detail; }}
          @task-navigate=${this._navigateTask} @task-highlight=${this._highlightTask}
          @feature-fold-toggle=${(event) => this.shadowRoot.querySelector('feature-board')._onFeatureFoldToggle(event)}
          @group-toggle=${(event) => this.shadowRoot.querySelector('feature-board')._onGroupToggle(event)}
          @feature-context-menu=${(event) => this._onFeatureContextMenu(event)}
          @group-context-menu=${(event) => this._onGroupContextMenu(event)}></task-list>
        <div id="board-area" style="--board-zoom: ${this.boardZoom}" role="region" aria-label="Timeline and Features">
          <feature-board .taskListVisible=${!packed && !collapsed}
            @task-highlight=${this._highlightTask}
            @task-layout-changed=${(event) => { this._taskLayout = event.detail; }}></feature-board>
          <!-- Vertical marker for today's date -->
          <div id="today-line" aria-hidden="true"></div>
          <!--
            Plugin overlays (annotation-overlay, link-editor-overlay, etc.) are
            appended here by their plugins.  As position:absolute siblings inside
            a position:relative ancestor they share board-space coordinates with
            feature-board.
          -->
        </div>
      </div>

      <div id="scroll-buttons" aria-label="Scroll controls">
        <button id="btn-scroll-top" class="scroll-btn" title="Scroll to top">▲</button>
        <button id="btn-scroll-bottom" class="scroll-btn" title="Scroll to bottom">▼</button>
      </div>
    `;
  }
}

customElements.define('timeline-board', TimelineBoard);
