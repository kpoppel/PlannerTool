import { bus } from '../core/EventBus.js';
import { DragEvents } from '../core/EventRegistry.js';
import { state } from '../services/State.js';
import { formatDate, parseDate, addDays } from './util.js';
import { getTimelineMonths } from './Timeline.lit.js';

// Derive month width from CSS variable to stay in sync with layout
const monthWidth = (() => {
  try{
    const val = getComputedStyle(document.documentElement).getPropertyValue('--timeline-month-width');
    const n = parseFloat(val);
    return isNaN(n) ? 120 : n;
  }catch(e){ return 120; }
})();

function getBoardOffset(){
  const board = document.querySelector('feature-board');
  if(!board) return 0;
  const pl = parseInt(getComputedStyle(board).paddingLeft,10);
  return isNaN(pl)?0:pl;
}

export function startDragMove(e, feature, card, updateDatesCb = state.updateFeatureDates.bind(state), featuresSource = state.features){
  const months = getTimelineMonths();
  const boardOffset = getBoardOffset();
  const startDateOrig = parseDate(feature.start);
  const endDateOrig = parseDate(feature.end);
  const durationDays = Math.round((endDateOrig - startDateOrig)/(1000*60*60*24)) + 1; // inclusive span
  let startX = e.clientX; const origLeft = parseInt(card.style.left,10);
  // Support feature-dates living inside shadowRoot for Lit-based cards
  const datesEl = (card.shadowRoot && card.shadowRoot.querySelector('.feature-dates')) || card.querySelector('.feature-dates');

  function dateFromLeft(px){
    const relative = (px - boardOffset) / monthWidth; // month index + fraction
    let monthIndex = Math.floor(relative);
    let fraction = relative - monthIndex;
    if(monthIndex < 0){ monthIndex = 0; fraction = 0; }
    if(monthIndex >= months.length){ monthIndex = months.length - 1; fraction = 0.999; }
    const monthStart = months[monthIndex];
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 0).getDate();
    const epsilon = 0.0001;
    // Map fraction -> day offset using rounded mapping so 100% fraction hits last day
    let dayOffset = Math.round(fraction * (daysInMonth - 1)); // 0..daysInMonth-1
    if(dayOffset < 0) dayOffset = 0;
    if(dayOffset >= daysInMonth) dayOffset = daysInMonth - 1;
    return new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 + dayOffset);
  }

  function onMove(ev){
    const dx = ev.clientX - startX; let newLeft = origLeft + dx; if(newLeft < boardOffset) newLeft = boardOffset; card.style.left = newLeft + 'px';
    const newStartDate = dateFromLeft(newLeft);
    const newEndDate = addDays(newStartDate, durationDays - 1);
    if(datesEl){ datesEl.textContent = formatDate(newStartDate) + ' → ' + formatDate(newEndDate); }
    // Notify listeners so dependency lines can update live
    bus.emit(DragEvents.MOVE, { featureId: feature.id, left: newLeft });
  }

  function onUp(){
    window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
    const finalLeft = parseInt(card.style.left,10);
    const newStartDate = dateFromLeft(finalLeft);
    const newEndDate = addDays(newStartDate, durationDays - 1);
    const newStartStr = formatDate(newStartDate);
    const newEndStr = formatDate(newEndDate);
    if(newStartStr !== feature.start || newEndStr !== feature.end){
      const updates = computeMoveUpdates(feature, newStartDate, newEndDate, featuresSource);
      applyUpdates(updates, updateDatesCb);
      bus.emit(DragEvents.END, { featureId: feature.id, start: newStartStr, end: newEndStr });
    } else {
      card.style.left = origLeft + 'px';
      if(datesEl){ datesEl.textContent = feature.start + ' → ' + feature.end; }
    }
  }
  window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
}

export function startResize(e, feature, card, datesEl, updateDatesCb = state.updateFeatureDates.bind(state), featuresSource = state.features){
  const startDate = parseDate(feature.start);
  let startX = e.clientX;
  const origWidth = parseInt(card.style.width,10);

  function endDateFromWidth(width){
    let remaining = width;
    let current = new Date(startDate);
    while(true){
      const daysInMonth = new Date(current.getFullYear(), current.getMonth()+1, 0).getDate();
      const sizePerDay = monthWidth / daysInMonth;
      const startDayIndex = current.getDate()-1; // 0-based
      const daysLeftInMonth = daysInMonth - startDayIndex;
      const widthForRemainingMonth = daysLeftInMonth * sizePerDay;
      if(remaining <= widthForRemainingMonth){
        const epsilon = 0.0001; // float safety
        // Use rounding so width that covers most of a day snaps to that day
        let daySpan = Math.max(1, Math.min(daysLeftInMonth, Math.round((remaining) / sizePerDay)));
        return addDays(current, daySpan-1);
      } else {
        remaining -= widthForRemainingMonth;
        current = new Date(current.getFullYear(), current.getMonth()+1, 1); // next month start
      }
    }
  }

  function widthForSpan(sDate, eDate){
    let w = 0;
    let cursor = new Date(sDate);
    while(cursor <= eDate){
      const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0).getDate();
      const sizePerDay = monthWidth / daysInMonth;
      const startDay = cursor.getDate();
      let lastDayThisMonth = (eDate.getFullYear()===cursor.getFullYear() && eDate.getMonth()===cursor.getMonth()) ? eDate.getDate() : daysInMonth;
      const daySpan = lastDayThisMonth - startDay + 1;
      w += daySpan * sizePerDay;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1);
    }
    return Math.max(40, Math.round(w));
  }

  function onMove(ev){
    const dx = ev.clientX - startX;
    let tentativeWidth = Math.max(10, origWidth + dx);
    let tentativeEnd = endDateFromWidth(tentativeWidth);
    if(feature.type === 'epic'){
      // Use effective featuresSource so scenario overrides are respected during visual clamp feedback
      const children = featuresSource.filter(ch => ch.parentEpic === feature.id);
      if(children.length){
        const maxChildEndStr = children.reduce((max, ch) => ch.end > max ? ch.end : max, children[0].end);
        const maxChildEnd = parseDate(maxChildEndStr);
        if(tentativeEnd < maxChildEnd){
          tentativeEnd = maxChildEnd;
          tentativeWidth = widthForSpan(startDate, tentativeEnd);
        }
      }
    }
    const snappedWidth = widthForSpan(startDate, tentativeEnd);
    card.style.width = snappedWidth + 'px';
    if(datesEl){ datesEl.textContent = feature.start + ' → ' + formatDate(tentativeEnd); }
    bus.emit(DragEvents.MOVE, { featureId: feature.id });
  }

  function onUp(){
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    const finalWidth = parseInt(card.style.width,10);
    const finalEnd = endDateFromWidth(finalWidth);
    let adjustedFinalEnd = finalEnd;
    const newEndStr = formatDate(adjustedFinalEnd);
    if(newEndStr !== feature.end){
      const updates = computeResizeUpdates(feature, adjustedFinalEnd, featuresSource);
      applyUpdates(updates, updateDatesCb);
      bus.emit(DragEvents.END, { featureId: feature.id, end: newEndStr });
    } else {
      if(datesEl){ datesEl.textContent = feature.start + ' → ' + feature.end; }
      card.style.width = origWidth + 'px';
    }
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function clampEpicEndAgainstChildren(epic, features, proposedEndStr){
  const children = features.filter(ch => ch.parentEpic === epic.id);
  if(!children.length) return proposedEndStr;
  const maxChildEnd = children.reduce((max, ch) => ch.end > max ? ch.end : max, children[0].end);
  return proposedEndStr < maxChildEnd ? maxChildEnd : proposedEndStr;
}

// Build list of update ops {id,start,end}
function computeMoveUpdates(feature, newStartDate, newEndDate, features){
  const updates = [];
  const origStart = parseDate(feature.start);
  const deltaDays = Math.round((newStartDate - origStart)/(1000*60*60*24));
  const newStartStr = formatDate(newStartDate);
    const newEndStr = formatDate(newEndDate);
  if(feature.type === 'epic'){
      // Move children first so scenario/baseline callbacks can react before epic final dates if desired.
      // Epic retains original duration; no clamping during a pure move.
      updates.push({ id: feature.id, start: newStartStr, end: newEndStr });
      if(deltaDays !== 0){
        const children = features.filter(ch => ch.parentEpic === feature.id);
        for(const ch of children){
          const chStart = parseDate(ch.start);
          const chEnd = parseDate(ch.end);
          const shiftedStart = addDays(chStart, deltaDays);
          const shiftedEnd = addDays(chEnd, deltaDays);
          // Mark child updates as originating from an epic move so upstream
          // processing can decide whether to overwrite existing child overrides.
          updates.push({ id: ch.id, start: formatDate(shiftedStart), end: formatDate(shiftedEnd), fromEpicMove: true });
        }
      }
  }
  // Feature or epic itself
  updates.push({ id: feature.id, start: newStartStr, end: newEndStr });
  return updates;
}

function computeResizeUpdates(feature, newEndDate, features){
  const updates = [];
  let newEndStr = formatDate(newEndDate);
  if(feature.type === 'epic'){
    newEndStr = clampEpicEndAgainstChildren(feature, features, newEndStr);
  }
  if(newEndStr !== feature.end){
    updates.push({ id: feature.id, start: feature.start, end: newEndStr });
  }
  return updates;
}

// Apply a list of updates using provided callback.
function applyUpdates(updates, updateDatesCb){
  updateDatesCb(updates);
}

// Export schedule helper functions for tests and other modules
export { computeMoveUpdates, computeResizeUpdates, applyUpdates };