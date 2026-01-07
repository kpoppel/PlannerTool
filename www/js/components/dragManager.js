import { bus } from '../core/EventBus.js';
import { DragEvents } from '../core/EventRegistry.js';
import { state } from '../services/State.js';
import { formatDate, parseDate, addDays } from './util.js';
import { getTimelineMonths, TIMELINE_CONFIG } from './Timeline.lit.js';
import { featureFlags } from '../config.js';

const getMonthWidth = () => TIMELINE_CONFIG.monthWidth;

const getBoardOffset = () => {
  const board = document.querySelector('feature-board');
  if (!board) return 0;
  const pl = parseInt(getComputedStyle(board).paddingLeft, 10);
  return Number.isNaN(pl) ? 0 : pl;
};

export function startDragMove(e, feature, card, updateDatesCb = state.updateFeatureDates.bind(state), featuresSource = state.features){
  const months = getTimelineMonths();
  const monthWidth = getMonthWidth();
  const boardOffset = getBoardOffset();
  
  // Check if feature is unplanned (ghosted)
  const isUnplanned = featureFlags.SHOW_UNPLANNED_WORK && (!feature.start || !feature.end);
  
  // For unplanned features, use today's date as start and 1-month duration
  let startDateOrig, endDateOrig, durationDays;
  if (isUnplanned) {
    startDateOrig = new Date();
    const oneMonthLater = new Date(startDateOrig);
    oneMonthLater.setMonth(startDateOrig.getMonth() + 1);
    endDateOrig = oneMonthLater;
    durationDays = Math.round((endDateOrig - startDateOrig) / (1000*60*60*24)) + 1;
  } else {
    startDateOrig = parseDate(feature.start);
    endDateOrig = parseDate(feature.end);
    durationDays = Math.round((endDateOrig - startDateOrig) / (1000*60*60*24)) + 1;
  }
  
  let startX = e.clientX;
  const origLeft = parseInt(card.style.left, 10);
  const datesEl = (card.shadowRoot && card.shadowRoot.querySelector('.feature-dates')) || card.querySelector('.feature-dates');

  function dateFromLeft(px){
    const relative = (px - boardOffset) / monthWidth;
    let monthIndex = Math.floor(relative);
    let fraction = relative - monthIndex;
    if (monthIndex < 0) { monthIndex = 0; fraction = 0; }
    if (monthIndex >= months.length) { monthIndex = months.length - 1; fraction = 0.999; }
    const monthStart = months[monthIndex];
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 0).getDate();
    let dayOffset = Math.round(fraction * (daysInMonth - 1));
    dayOffset = Math.max(0, Math.min(dayOffset, daysInMonth - 1));
    return new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 + dayOffset);
  }

  function onMove(ev){
    const dx = ev.clientX - startX; let newLeft = origLeft + dx; if(newLeft < boardOffset) newLeft = boardOffset; card.style.left = newLeft + 'px';
    const newStartDate = dateFromLeft(newLeft);
    const newEndDate = addDays(newStartDate, durationDays - 1);
    const liveDatesText = formatDate(newStartDate) + ' → ' + formatDate(newEndDate);
    if (card && typeof card.setLiveDates === 'function') card.setLiveDates(liveDatesText);
    else if (datesEl) datesEl.textContent = liveDatesText;
    // Notify listeners so dependency lines can update live
    bus.emit(DragEvents.MOVE, { featureId: feature.id, left: newLeft });
  }

  function onUp(){
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    const finalLeft = parseInt(card.style.left,10);
    const newStartDate = dateFromLeft(finalLeft);
    const newEndDate = addDays(newStartDate, durationDays - 1);
    const newStartStr = formatDate(newStartDate);
    const newEndStr = formatDate(newEndDate);
    if (newStartStr !== feature.start || newEndStr !== feature.end) {
      const updates = computeMoveUpdates(feature, newStartDate, newEndDate, featuresSource);
      
      // If planning an unplanned child feature, also plan its parent epic
      if (isUnplanned && feature.parentEpic) {
        const epic = featuresSource.find(f => f.id === feature.parentEpic);
        if (epic && (!epic.start || !epic.end)) {
          // Plan the epic with the same dates as the child
          updates.push({ id: epic.id, start: newStartStr, end: newEndStr });
        }
      }
      
      applyUpdates(updates, updateDatesCb);
      bus.emit(DragEvents.END, { featureId: feature.id, start: newStartStr, end: newEndStr });
    } else {
      card.style.left = origLeft + 'px';
    }
    card.clearLiveDates();
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

export function startResize(e, feature, card, datesEl, updateDatesCb = state.updateFeatureDates.bind(state), featuresSource = state.features){
  const monthWidth = getMonthWidth();
  
  // Check if feature is unplanned (ghosted)
  const isUnplanned = featureFlags.SHOW_UNPLANNED_WORK && (!feature.start || !feature.end);
  
  // For unplanned features, fix start date at today's date
  const startDate = isUnplanned ? new Date() : parseDate(feature.start);
  let startX = e.clientX;
  const origWidth = parseInt(card.style.width, 10);

  function endDateFromWidth(width){
    let remaining = width;
    let current = new Date(startDate);
    while(true){
      const daysInMonth = new Date(current.getFullYear(), current.getMonth()+1, 0).getDate();
      const sizePerDay = monthWidth / daysInMonth;
      const startDayIndex = current.getDate() - 1;
      const daysLeftInMonth = daysInMonth - startDayIndex;
      const widthForRemainingMonth = daysLeftInMonth * sizePerDay;
      if (remaining <= widthForRemainingMonth) {
        const daySpan = Math.max(1, Math.min(daysLeftInMonth, Math.round(remaining / sizePerDay)));
        return addDays(current, daySpan - 1);
      }
      remaining -= widthForRemainingMonth;
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
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
    const liveDatesTextR = feature.start + ' → ' + formatDate(tentativeEnd);
    if (card && typeof card.setLiveDates === 'function') card.setLiveDates(liveDatesTextR);
    else if (datesEl) datesEl.textContent = liveDatesTextR;
    bus.emit(DragEvents.MOVE, { featureId: feature.id });
  }

  function onUp(){
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    const finalWidth = parseInt(card.style.width,10);
    const finalEnd = endDateFromWidth(finalWidth);
    let adjustedFinalEnd = finalEnd;
    const newStartStr = formatDate(startDate);
    const newEndStr = formatDate(adjustedFinalEnd);
    
    // For unplanned features, we need to set both start and end dates
    if (isUnplanned) {
      if (newEndStr !== feature.end || newStartStr !== feature.start) {
        const updates = [{ id: feature.id, start: newStartStr, end: newEndStr }];
        
        // If planning an unplanned child feature, also plan its parent epic
        if (feature.parentEpic) {
          const epic = featuresSource.find(f => f.id === feature.parentEpic);
          if (epic && (!epic.start || !epic.end)) {
            // Plan the epic with the same dates as the child
            updates.push({ id: epic.id, start: newStartStr, end: newEndStr });
          }
        }
        
        applyUpdates(updates, updateDatesCb);
        bus.emit(DragEvents.END, { featureId: feature.id, start: newStartStr, end: newEndStr });
      } else {
        card.style.width = origWidth + 'px';
      }
    } else {
      // Normal resize for planned features (only end date changes)
      if (newEndStr !== feature.end) {
        const updates = computeResizeUpdates(feature, adjustedFinalEnd, featuresSource);
        applyUpdates(updates, updateDatesCb);
        bus.emit(DragEvents.END, { featureId: feature.id, end: newEndStr });
      } else {
        card.style.width = origWidth + 'px';
      }
    }
    // Clear any live-date overlay left from a drag/resize so the
    // lit-rendered default dates (bound to `feature.start/end`) become visible.
    card.clearLiveDates();
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
  const isUnplannedEpic = featureFlags.SHOW_UNPLANNED_WORK && feature.type === 'epic' && (!feature.start || !feature.end);
  const origStart = feature.start ? parseDate(feature.start) : null;
  const deltaDays = origStart ? Math.round((newStartDate - origStart)/(1000*60*60*24)) : 0;
  const newStartStr = formatDate(newStartDate);
  const newEndStr = formatDate(newEndDate);
  
  if(feature.type === 'epic'){
      // Move children first so scenario/baseline callbacks can react before epic final dates if desired.
      // Epic retains original duration; no clamping during a pure move.
      updates.push({ id: feature.id, start: newStartStr, end: newEndStr });
      
      if(deltaDays !== 0 || isUnplannedEpic){
        const children = features.filter(ch => ch.parentEpic === feature.id);
        for(const ch of children){
          const isUnplannedChild = featureFlags.SHOW_UNPLANNED_WORK && (!ch.start || !ch.end);
          
          if (isUnplannedChild) {
            // Unplanned child gets 1-month default duration starting from epic's new start date
            const childStart = new Date(newStartDate);
            const childEnd = new Date(childStart);
            childEnd.setMonth(childStart.getMonth() + 1);
            updates.push({ 
              id: ch.id, 
              start: formatDate(childStart), 
              end: formatDate(childEnd), 
              fromEpicMove: true 
            });
          } else {
            // Planned child gets shifted by delta
            const chStart = parseDate(ch.start);
            const chEnd = parseDate(ch.end);
            const shiftedStart = addDays(chStart, deltaDays);
            const shiftedEnd = addDays(chEnd, deltaDays);
            updates.push({ 
              id: ch.id, 
              start: formatDate(shiftedStart), 
              end: formatDate(shiftedEnd), 
              fromEpicMove: true 
            });
          }
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