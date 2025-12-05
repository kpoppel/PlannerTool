import { state } from './state.js';
import { formatDate, parseDate, addDays } from './util.js';
import { getTimelineMonths } from './timeline.js';
import { computeMoveUpdates, computeResizeUpdates, applyUpdates } from './scheduleService.js';
import { bus } from './eventBus.js';

const monthWidth = 120;

function getBoardOffset(){
  const board = document.getElementById('featureBoard');
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
  const datesEl = card.querySelector('.feature-dates');

  function dateFromLeft(px){
    const relative = (px - boardOffset) / monthWidth; // month index + fraction
    let monthIndex = Math.floor(relative);
    let fraction = relative - monthIndex;
    if(monthIndex < 0){ monthIndex = 0; fraction = 0; }
    if(monthIndex >= months.length){ monthIndex = months.length - 1; fraction = 0.999; }
    const monthStart = months[monthIndex];
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 0).getDate();
    const epsilon = 0.0001;
    let dayOffset = Math.floor((fraction * daysInMonth) + epsilon); // 0..daysInMonth-1
    if(dayOffset >= daysInMonth) dayOffset = daysInMonth - 1;
    return new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 + dayOffset);
  }

  function onMove(ev){
    const dx = ev.clientX - startX; let newLeft = origLeft + dx; if(newLeft < boardOffset) newLeft = boardOffset; card.style.left = newLeft + 'px';
    const newStartDate = dateFromLeft(newLeft);
    const newEndDate = addDays(newStartDate, durationDays - 1);
    if(datesEl){ datesEl.textContent = formatDate(newStartDate) + ' → ' + formatDate(newEndDate); }
    // Notify listeners so dependency lines can update live
    bus.emit('drag:move', { featureId: feature.id, left: newLeft });
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
      bus.emit('drag:end', { featureId: feature.id, start: newStartStr, end: newEndStr });
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
        let daySpan = Math.floor((remaining + epsilon) / sizePerDay);
        if(daySpan < 1) daySpan = 1;
        if(daySpan > daysLeftInMonth) daySpan = daysLeftInMonth;
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
    bus.emit('drag:move', { featureId: feature.id });
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
      bus.emit('drag:end', { featureId: feature.id, end: newEndStr });
    } else {
      if(datesEl){ datesEl.textContent = feature.start + ' → ' + feature.end; }
      card.style.width = origWidth + 'px';
    }
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
