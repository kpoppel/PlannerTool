import { getTimelineMonths, TIMELINE_CONFIG } from './Timeline.lit.js';
import { parseDate, daysInMonth } from './util.js';
import { state } from '../services/State.js';
import { featureFlags } from '../config.js';
import { bus } from '../core/EventBus.js';
import { TimelineEvents } from '../core/EventRegistry.js';

// Helper to locate elements inside timeline-board's render root when TimelineBoard
// uses shadow DOM.
export function findInBoard(selector) {
  const boardEl = document.querySelector('timeline-board');
  if (!boardEl) return null;
  const root = boardEl.renderRoot || boardEl.shadowRoot || boardEl;
  return root && root.querySelector ? root.querySelector(selector) : null;
}

const getMonthWidth = () => TIMELINE_CONFIG.monthWidth;

let _cachedMonthsRef = null;
let _cachedMonthStarts = null;
let _cachedMonthEnds = null; // Use actual next month start times to handle DST correctly
let _cachedMonthDays = null;

const _buildMonthCache = (months) => {
  _cachedMonthsRef = months;
  _cachedMonthStarts = months.map((m) => m.getTime());
  _cachedMonthDays = months.map((m) => daysInMonth(m));
  // Cache the actual end time for each month (start of next month)
  // This correctly handles DST transitions where days != 24 hours
  _cachedMonthEnds = months.map((m, i) => {
    if (i < months.length - 1) {
      return months[i + 1].getTime();
    }
    // For the last month, calculate the next month's start
    return new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime();
  });
};

/**
 * Binary search to find which month contains a given timestamp.
 * Uses cached month end times to correctly handle DST transitions.
 * @param {number} msVal - Timestamp in milliseconds
 * @returns {number} Month index, or -1 if before first month
 */
const findMonthIndexFor = (msVal) => {
  const arr = _cachedMonthStarts;
  if (!arr || arr.length === 0) return -1;
  let lo = 0,
    hi = arr.length - 1;
  if (msVal < arr[0]) return -1;
  if (msVal >= arr[hi]) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midStart = arr[mid];
    // Use the actual next month's start time instead of calculating with days * msPerDay
    // This correctly handles DST transitions
    const midEnd = _cachedMonthEnds[mid];
    if (msVal >= midStart && msVal < midEnd) return mid;
    if (msVal < midStart) hi = mid - 1;
    else lo = mid + 1;
  }
  return -1;
};

export const laneHeight = () => (state._viewService.condensedCards ? 28 : 64);

export const computePosition = (feature, monthsArg) => {
  const months = monthsArg || getTimelineMonths();
  const monthWidth = getMonthWidth();
  if (
    !_cachedMonthsRef ||
    _cachedMonthsRef.length !== months.length ||
    _cachedMonthsRef[0].getTime() !== months[0].getTime()
  )
    _buildMonthCache(months);

  const resolveMonthIndex = (timestamp) => {
    const idx = findMonthIndexFor(timestamp);
    if (idx >= 0) return idx;
    return timestamp < _cachedMonthStarts[0] ? 0 : months.length - 1;
  };

  // Handle unplanned features (when feature flag is ON)
  const isUnplanned =
    featureFlags.SHOW_UNPLANNED_WORK && (!feature.start || !feature.end);
  const startDate =
    isUnplanned ?
      new Date()
    : (parseDate(feature.start) || new Date('2025-01-01'));
  const endDate =
    isUnplanned ?
      (() => {
        const oneMonthLater = new Date(startDate);
        oneMonthLater.setMonth(startDate.getMonth() + 1);
        return oneMonthLater;
      })()
    : (parseDate(feature.end) || new Date('2025-01-15'));

  const ms = startDate.getTime();
  const ems = endDate.getTime();
  const startIdx = resolveMonthIndex(ms);
  const endIdx = resolveMonthIndex(ems);

  const startDays = _cachedMonthDays[startIdx];
  const endDays = _cachedMonthDays[endIdx];
  const startFraction = (startDate.getDate() - 1) / startDays;
  const endFraction = endDate.getDate() / endDays;

  const left = (startIdx + startFraction) * monthWidth;
  const spanContinuous = endIdx + endFraction - (startIdx + startFraction);
  let width = spanContinuous * monthWidth;

  // Dynamic minimum width based on zoom level
  // At weeks (240px/month): min 40px (keeps large features usable)
  // At months (120px/month): min 20px (scales down)
  // At quarters (60px/month): min 10px (scales down further)
  // At years (30px/month): min 5px (allows very small features)
  const minVisualWidth = Math.max(5, monthWidth / 6);
  if (width < minVisualWidth) width = minVisualWidth;

  return { left, width };
};

export const _test_resetCache = () => {
  _cachedMonthsRef = null;
  _cachedMonthStarts = null;
  _cachedMonthEnds = null;
  _cachedMonthDays = null;
};

// Listen for scale changes and reset cache
bus.on(TimelineEvents.SCALE_CHANGED, () => {
  _test_resetCache();
});

/**
 * Calculate the pixel X position for today's date given the current months array.
 * Returns null if today is outside the visible month range.
 * @param {Date[]} months - Array of month start Date objects from getTimelineMonths()
 * @returns {number|null} X offset in pixels, or null if today is not in range
 */
export function calcTodayX(months) {
  if (!months || months.length === 0) return null;
  const today = new Date();
  const todayMs = today.getTime();
  const monthWidth = getMonthWidth();

  let idx = -1;
  for (let i = 0; i < months.length; i++) {
    const start = months[i].getTime();
    const end =
      i + 1 < months.length
        ? months[i + 1].getTime()
        : new Date(months[i].getFullYear(), months[i].getMonth() + 1, 1).getTime();
    if (todayMs >= start && todayMs < end) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;

  const monthStart = months[idx];
  const dayCount = daysInMonth(monthStart);
  const fraction = (today.getDate() - 1) / dayCount;
  return (idx + fraction) * monthWidth;
}
