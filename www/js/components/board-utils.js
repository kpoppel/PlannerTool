import { getTimelineMonths } from './Timeline.lit.js';
import { parseDate } from './util.js';
import { state } from '../services/State.js';

const monthWidth = 120;

let _cachedMonthsRef = null;
let _cachedMonthStarts = null;
let _cachedMonthDays = null;

function _buildMonthCache(months) {
  _cachedMonthsRef = months;
  _cachedMonthStarts = months.map(m => m.getTime());
  _cachedMonthDays = months.map(m => new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate());
}

export function laneHeight() {
  return state.condensedCards ? 40 : 64;
}

export function getBoardOffset() {
  const board = typeof document !== 'undefined' ? document.querySelector('feature-board') : null;
  if (!board) return 0;
  const pl = parseInt(getComputedStyle(board).paddingLeft, 10);
  return isNaN(pl) ? 0 : pl;
}

export function computePosition(feature, monthsArg) {
  const months = monthsArg || getTimelineMonths();
  if (!_cachedMonthsRef || _cachedMonthsRef.length !== months.length || (_cachedMonthsRef[0] && months[0] && _cachedMonthsRef[0].getTime() !== months[0].getTime())) {
    _buildMonthCache(months);
  }
  let startDate = parseDate(feature.start);
  let endDate = parseDate(feature.end);
  if (!(startDate instanceof Date) || isNaN(startDate.getTime())) startDate = new Date('2025-01-01');
  if (!(endDate instanceof Date) || isNaN(endDate.getTime())) endDate = new Date('2025-01-15');

  const ms = startDate.getTime();
  const ems = endDate.getTime();
  function findMonthIndexFor(msVal) {
    const arr = _cachedMonthStarts; let lo = 0, hi = arr.length - 1;
    if (msVal < arr[0]) return -1;
    if (msVal >= arr[hi]) return hi;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1; const midStart = arr[mid]; const midEnd = midStart + (_cachedMonthDays[mid] * 24 * 60 * 60 * 1000);
      if (msVal >= midStart && msVal < midEnd) return mid;
      if (msVal < midStart) hi = mid - 1; else lo = mid + 1;
    }
    return -1;
  }
  let startIdx = findMonthIndexFor(ms);
  if (startIdx < 0) startIdx = ms < _cachedMonthStarts[0] ? 0 : months.length - 1;
  let endIdx = findMonthIndexFor(ems);
  if (endIdx < 0) endIdx = ems < _cachedMonthStarts[0] ? 0 : months.length - 1;

  const startDays = _cachedMonthDays[startIdx];
  const endDays = _cachedMonthDays[endIdx];
  const startFraction = (startDate.getDate() - 1) / startDays;
  const endFraction = (endDate.getDate()) / endDays;

  const boardOffset = getBoardOffset();
  const left = boardOffset + (startIdx + startFraction) * monthWidth;
  const spanContinuous = (endIdx + endFraction) - (startIdx + startFraction);
  let width = spanContinuous * monthWidth;
  const minVisualWidth = 40;
  if (width < minVisualWidth) width = minVisualWidth;

  return { left, width };
}

export function _test_resetCache() {
  _cachedMonthsRef = null; _cachedMonthStarts = null; _cachedMonthDays = null;
}
