import { getTimelineMonths, TIMELINE_CONFIG } from './Timeline.lit.js';
import { parseDate } from './util.js';
import { state } from '../services/State.js';
import { featureFlags } from '../config.js';
import { bus } from '../core/EventBus.js';
import { TimelineEvents } from '../core/EventRegistry.js';

const getMonthWidth = () => TIMELINE_CONFIG.monthWidth;

let _cachedMonthsRef = null;
let _cachedMonthStarts = null;
let _cachedMonthEnds = null;  // Use actual next month start times to handle DST correctly
let _cachedMonthDays = null;

const _buildMonthCache = (months) => {
  _cachedMonthsRef = months;
  _cachedMonthStarts = months.map(m => m.getTime());
  _cachedMonthDays = months.map(m => new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate());
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
  let lo = 0, hi = arr.length - 1;
  if (msVal < arr[0]) return -1;
  if (msVal >= arr[hi]) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midStart = arr[mid];
    // Use the actual next month's start time instead of calculating with days * msPerDay
    // This correctly handles DST transitions
    const midEnd = _cachedMonthEnds[mid];
    if (msVal >= midStart && msVal < midEnd) return mid;
    if (msVal < midStart) hi = mid - 1; else lo = mid + 1;
  }
  return -1;
};

export const laneHeight = () => state._viewService.condensedCards ? 40 : 64;

export const getBoardOffset = () => {
  const board = document.querySelector('feature-board');
  if (!board) return 0;
  const pl = parseInt(getComputedStyle(board).paddingLeft, 10);
  return Number.isNaN(pl) ? 0 : pl;
};

export const computePosition = (feature, monthsArg) => {
  const months = monthsArg || getTimelineMonths();
  const monthWidth = getMonthWidth();
  if (!_cachedMonthsRef || _cachedMonthsRef.length !== months.length || _cachedMonthsRef[0].getTime() !== months[0].getTime()) _buildMonthCache(months);
  
  // Handle unplanned features (when feature flag is ON)
  if (featureFlags.SHOW_UNPLANNED_WORK && (!feature.start || !feature.end)) {
    // Position at today's date with 1-month default duration
    const today = new Date();
    const oneMonthLater = new Date(today);
    oneMonthLater.setMonth(today.getMonth() + 1);
    
    const startDate = today;
    const endDate = oneMonthLater;
    
    const ms = startDate.getTime();
    const ems = endDate.getTime();
    
    let startIdx = findMonthIndexFor(ms);
    startIdx = startIdx < 0 ? (ms < _cachedMonthStarts[0] ? 0 : months.length - 1) : startIdx;
    let endIdx = findMonthIndexFor(ems);
    endIdx = endIdx < 0 ? (ems < _cachedMonthStarts[0] ? 0 : months.length - 1) : endIdx;

    const startDays = _cachedMonthDays[startIdx];
    const endDays = _cachedMonthDays[endIdx];
    const startFraction = (startDate.getDate() - 1) / startDays;
    const endFraction = (endDate.getDate()) / endDays;

    const boardOffset = getBoardOffset();
    const left = boardOffset + (startIdx + startFraction) * monthWidth;
    const spanContinuous = (endIdx + endFraction) - (startIdx + startFraction);
    let width = spanContinuous * monthWidth;
    
    // Dynamic minimum width based on zoom level
    const minVisualWidth = Math.max(5, monthWidth / 6);
    if (width < minVisualWidth) width = minVisualWidth;

    return { left, width };
  }
  
  // Normal processing for planned features
  let startDate = parseDate(feature.start) || new Date('2025-01-01');
  let endDate = parseDate(feature.end) || new Date('2025-01-15');

  const ms = startDate.getTime();
  const ems = endDate.getTime();
  let startIdx = findMonthIndexFor(ms);
  startIdx = startIdx < 0 ? (ms < _cachedMonthStarts[0] ? 0 : months.length - 1) : startIdx;
  let endIdx = findMonthIndexFor(ems);
  endIdx = endIdx < 0 ? (ems < _cachedMonthStarts[0] ? 0 : months.length - 1) : endIdx;

  const startDays = _cachedMonthDays[startIdx];
  const endDays = _cachedMonthDays[endIdx];
  const startFraction = (startDate.getDate() - 1) / startDays;
  const endFraction = (endDate.getDate()) / endDays;

  const boardOffset = getBoardOffset();
  const left = boardOffset + (startIdx + startFraction) * monthWidth;
  const spanContinuous = (endIdx + endFraction) - (startIdx + startFraction);
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

export const _test_resetCache = () => { _cachedMonthsRef = null; _cachedMonthStarts = null; _cachedMonthEnds = null; _cachedMonthDays = null; };

// Listen for scale changes and reset cache
bus.on(TimelineEvents.SCALE_CHANGED, () => {
  _test_resetCache();
});
