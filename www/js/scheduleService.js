// scheduleService.js
// Centralised feature scheduling logic (move/resize) decoupled from UI events.
// Accepts a generic update callback so scenarios can override persistence.
import { parseDate, formatDate, addDays } from './util.js';

// Inclusive span helper (currently unused but kept for potential duration calculations)
function daysBetweenInclusive(a, b){
  return Math.round((b - a)/(1000*60*60*24)) + 1;
}

function clampEpicEndAgainstChildren(epic, features, proposedEndStr){
  const children = features.filter(ch => ch.parentEpic === epic.id);
  if(!children.length) return proposedEndStr;
  const maxChildEnd = children.reduce((max, ch) => ch.end > max ? ch.end : max, children[0].end);
  return proposedEndStr < maxChildEnd ? maxChildEnd : proposedEndStr;
}

// Build list of update ops {id,start,end}
export function computeMoveUpdates(feature, newStartDate, newEndDate, features){
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
          updates.push({ id: ch.id, start: formatDate(shiftedStart), end: formatDate(shiftedEnd) });
        }
      }
  }
  // Feature or epic itself
  updates.push({ id: feature.id, start: newStartStr, end: newEndStr });
  return updates;
}

export function computeResizeUpdates(feature, newEndDate, features){
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
export function applyUpdates(updates, updateDatesCb){
  for(const u of updates){
    updateDatesCb(u.id, u.start, u.end);
  }
}
