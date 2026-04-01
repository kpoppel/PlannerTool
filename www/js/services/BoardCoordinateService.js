/**
 * BoardCoordinateService.js
 * Canonical single source of truth for:
 *  - Board-space ↔ screen-space coordinate transforms
 *  - Date ↔ board-X-position transforms
 *  - Scroll position (read-only)
 *  - Panning-allowed flag (replaces Timeline.lit.js setTimelinePanningAllowed)
 *  - Scroll-change subscriptions (replaces per-overlay scroll listeners)
 *
 * Initialised once by TimelineBoard after its first layout via:
 *   boardCoords.init(scrollContainer, boardArea)
 *
 * Board space origin: (0, 0) = top-left corner of the card area (#board-area),
 * i.e. below the sticky timeline header.
 *
 * Key insight: getBoundingClientRect() on boardArea already accounts for all
 * scroll offsets, so boardToScreen / screenToBoard need no manual scroll maths.
 */

import { TIMELINE_CONFIG, getTimelineMonths } from '../components/Timeline.lit.js';
import { parseDate } from '../components/util.js';

class BoardCoordinateService {
  constructor() {
    /** @type {HTMLElement|null} */
    this._scrollContainer = null;
    /** @type {HTMLElement|null} */
    this._boardArea = null;
    /** @type {Set<Function>} */
    this._subscribers = new Set();
    this._panningAllowed = true;
    this._onScroll = this._onScroll.bind(this);
  }

  /**
   * Wire up the service to the real DOM elements.
   * Called by TimelineBoard once after first layout.
   * @param {HTMLElement} scrollContainer - The single overflow:auto container
   * @param {HTMLElement} boardArea       - The #board-area positioned div (coord origin)
   */
  init(scrollContainer, boardArea) {
    // Detach from any previous container
    if (this._scrollContainer) {
      this._scrollContainer.removeEventListener('scroll', this._onScroll);
    }
    this._scrollContainer = scrollContainer;
    this._boardArea = boardArea;
    scrollContainer.addEventListener('scroll', this._onScroll, { passive: true });
  }

  _onScroll() {
    const { scrollX, scrollY } = this;
    for (const fn of this._subscribers) {
      try { fn({ scrollX, scrollY }); } catch (e) { /* ignore subscriber errors */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Scroll state
  // ---------------------------------------------------------------------------

  /** Current horizontal scroll offset of the board container (pixels). */
  get scrollX() {
    return this._scrollContainer?.scrollLeft ?? 0;
  }

  /** Current vertical scroll offset of the board container (pixels). */
  get scrollY() {
    return this._scrollContainer?.scrollTop ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Panning control
  // ---------------------------------------------------------------------------

  /** Whether mouse-drag panning is currently permitted. */
  get panningAllowed() {
    return this._panningAllowed;
  }

  /**
   * Allow or block drag-panning (e.g. disabled while drawing annotations).
   * @param {boolean} val
   */
  setPanningAllowed(val) {
    this._panningAllowed = !!val;
  }

  // ---------------------------------------------------------------------------
  // Coordinate transforms
  // ---------------------------------------------------------------------------

  /**
   * Convert board-space coordinates to screen (viewport / clientX/Y) coordinates.
   * getBoundingClientRect() already accounts for all ancestor scroll so no manual
   * scroll arithmetic is needed.
   *
   * @param {number} boardX - X in board space (0 = left edge of card area)
   * @param {number} boardY - Y in board space (0 = top edge of card area)
   * @returns {{ x: number, y: number }} Screen coordinates
   */
  boardToScreen(boardX, boardY) {
    if (!this._boardArea) return { x: boardX, y: boardY };
    const rect = this._boardArea.getBoundingClientRect();
    return { x: rect.left + boardX, y: rect.top + boardY };
  }

  /**
   * Convert screen (viewport / clientX/Y) coordinates to board-space coordinates.
   *
   * @param {number} screenX
   * @param {number} screenY
   * @returns {{ x: number, y: number }} Board coordinates
   */
  screenToBoard(screenX, screenY) {
    if (!this._boardArea) return { x: screenX, y: screenY };
    const rect = this._boardArea.getBoundingClientRect();
    return { x: screenX - rect.left, y: screenY - rect.top };
  }

  /**
   * Is the given screen point inside the visible board rectangle?
   * @param {number} screenX
   * @param {number} screenY
   * @returns {boolean}
   */
  isScreenPointInBoard(screenX, screenY) {
    if (!this._boardArea) return false;
    const rect = this._boardArea.getBoundingClientRect();
    return (
      screenX >= rect.left &&
      screenX <= rect.right &&
      screenY >= rect.top &&
      screenY <= rect.bottom
    );
  }

  // ---------------------------------------------------------------------------
  // Date ↔ board-X transforms
  // ---------------------------------------------------------------------------

  /**
   * Convert a Date (or ISO date string) to an X position in board space.
   * Board X 0 corresponds to the start of the first month in the timeline.
   *
   * @param {Date|string} date
   * @returns {number} Board X in pixels
   */
  dateToContentX(date) {
    const months = getTimelineMonths();
    const monthWidth = TIMELINE_CONFIG.monthWidth;
    if (!months || !months.length) return 0;

    const d = date instanceof Date ? date : parseDate(date);
    if (!d || isNaN(d.getTime())) return 0;

    const ms = d.getTime();
    const starts = months.map((m) => m.getTime());

    // Binary search: find month whose range contains ms
    let lo = 0;
    let hi = starts.length - 1;
    let idx = -1;

    if (ms < starts[0]) {
      idx = 0;
    } else if (ms >= starts[hi]) {
      idx = hi;
    } else {
      lo = 0;
      hi = starts.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const end = mid + 1 < starts.length ? starts[mid + 1] : Infinity;
        if (ms >= starts[mid] && ms < end) {
          idx = mid;
          break;
        }
        if (ms < starts[mid]) hi = mid - 1;
        else lo = mid + 1;
      }
    }

    if (idx < 0) return 0;

    const monthStart = months[idx];
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const fraction = (d.getDate() - 1) / daysInMonth;
    return (idx + fraction) * monthWidth;
  }

  /**
   * Convert an X position in board space to a timestamp (ms since epoch).
   *
   * @param {number} x - Board X in pixels
   * @returns {number} Timestamp in milliseconds
   */
  contentXToDateMs(x) {
    const months = getTimelineMonths();
    const monthWidth = TIMELINE_CONFIG.monthWidth;
    if (!months || !months.length || monthWidth <= 0) return Date.now();

    const rawIndex = x / monthWidth;
    const monthIdx = Math.max(0, Math.min(Math.floor(rawIndex), months.length - 1));
    const fraction = rawIndex - monthIdx;
    const monthStart = months[monthIdx];
    const daysInMonth = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth() + 1,
      0
    ).getDate();
    const dayOffset = Math.round(fraction * daysInMonth);
    return new Date(
      monthStart.getFullYear(),
      monthStart.getMonth(),
      1 + dayOffset
    ).getTime();
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to scroll events on the board container.
   * @param {Function} fn - Called with { scrollX, scrollY } on every scroll
   * @returns {Function} Unsubscribe function
   */
  subscribe(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }
}

/** Singleton instance — import and use directly. */
export const boardCoords = new BoardCoordinateService();
