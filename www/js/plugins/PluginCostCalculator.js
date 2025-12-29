// PluginCostCalculator.js
// Extracted calculation helpers from PluginCostComponent
import { isEnabled } from '../config.js';
function toDate(d){ return d ? new Date(d+'T00:00:00Z') : null; }
function firstOfMonth(dt){ return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1)); }
function lastOfMonth(dt){ return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth()+1, 0)); }
function addMonths(dt, n){ return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth()+n, 1)); }
function monthKey(dt){ return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth()+1).padStart(2,'0'); }
function monthLabel(dt){ return dt.toLocaleString(undefined, { month: 'short', year: 'numeric' }); }

function buildMonths(configuration){
  if(!configuration) return [];
  const ds = toDate(configuration.dataset_start);
  const de = toDate(configuration.dataset_end);
  if(!ds || !de) return [];
  const start = firstOfMonth(ds);
  const end = firstOfMonth(de);
  const months = [];
  let cur = start;
  while(cur <= end){ months.push(new Date(cur)); cur = addMonths(cur,1); }
  return months;
}

function buildProjects(projects, months, state){
    /*
    The epic gap-fill algorithm:
Aggregates child monthly totals for internal/external costs and hours.
For each epic month where child totals are zero, uses epic's own monthly values if they exist; otherwise uses the average child monthly internal/external totals (or hours) as an estimate.
Final epic totals are computed as the sum of these filled month values and rounded similar to other calculations.*/
  const monthKeys = months.map(m=>monthKey(m));
  const useEpicGapFills = isEnabled('USE_EPIC_CAPACITY_GAP_FILLS');

  const projectsOut = (projects||[]).map(p=>{
    // First, compute feature objects for all features
    const featsPre = (p.features||[]).map(f=>{
      const start = toDate(f.start || f.start_date || f.starts_at);
      const end = toDate(f.end || f.end_date || f.ends_at);
      const internalTotal = (f.metrics && (f.metrics.internal?.cost || 0)) || 0;
      const externalTotal = (f.metrics && (f.metrics.external?.cost || 0)) || 0;
      const internalHoursTotal = (f.metrics && (f.metrics.internal?.hours || 0)) || 0;
      const externalHoursTotal = (f.metrics && (f.metrics.external?.hours || 0)) || 0;
      const feature_name = f.title || f.name || String(f.id || f.id === 0 ? f.id : '');
      const feature_state = f.state || f.status || '';
      const sMonth = firstOfMonth(start || months[0]);
      const eMonth = firstOfMonth(end || months[months.length-1]);
      const monthsCovered = [];
      let cur = new Date(sMonth);
      while(cur <= eMonth){ monthsCovered.push(monthKey(cur)); cur = addMonths(cur,1); }
      const perMonthInternal = monthsCovered.length ? (internalTotal / monthsCovered.length) : 0;
      const perMonthExternal = monthsCovered.length ? (externalTotal / monthsCovered.length) : 0;
      const perMonthInternalHours = monthsCovered.length ? (internalHoursTotal / monthsCovered.length) : 0;
      const perMonthExternalHours = monthsCovered.length ? (externalHoursTotal / monthsCovered.length) : 0;
      const internalValues = Object.fromEntries(monthKeys.map(k=>[k,0]));
      const externalValues = Object.fromEntries(monthKeys.map(k=>[k,0]));
      const internalHoursValues = Object.fromEntries(monthKeys.map(k=>[k,0]));
      const externalHoursValues = Object.fromEntries(monthKeys.map(k=>[k,0]));
      for(const mk of monthsCovered){ if(mk in internalValues) internalValues[mk] = +(perMonthInternal.toFixed(2)); if(mk in externalValues) externalValues[mk] = +(perMonthExternal.toFixed(2)); if(mk in internalHoursValues) internalHoursValues[mk] = +(perMonthInternalHours.toFixed(2)); if(mk in externalHoursValues) externalHoursValues[mk] = +(perMonthExternalHours.toFixed(2)); }
      const sumInt = Object.values(internalValues).reduce((a,b)=>a+b,0);
      if(monthsCovered.length && Math.abs(sumInt - internalTotal) > 0.001){ const last = monthsCovered[monthsCovered.length-1]; internalValues[last] = +(internalValues[last] + (internalTotal - sumInt)).toFixed(2); }
      const sumExt = Object.values(externalValues).reduce((a,b)=>a+b,0);
      if(monthsCovered.length && Math.abs(sumExt - externalTotal) > 0.001){ const last = monthsCovered[monthsCovered.length-1]; externalValues[last] = +(externalValues[last] + (externalTotal - sumExt)).toFixed(2); }
      const sumIntH = Object.values(internalHoursValues).reduce((a,b)=>a+b,0);
      if(monthsCovered.length && Math.abs(sumIntH - internalHoursTotal) > 0.001){ const last = monthsCovered[monthsCovered.length-1]; internalHoursValues[last] = +(internalHoursValues[last] + (internalHoursTotal - sumIntH)).toFixed(2); }
      const sumExtH = Object.values(externalHoursValues).reduce((a,b)=>a+b,0);
      if(monthsCovered.length && Math.abs(sumExtH - externalHoursTotal) > 0.001){ const last = monthsCovered[monthsCovered.length-1]; externalHoursValues[last] = +(externalHoursValues[last] + (externalHoursTotal - sumExtH)).toFixed(2); }
      const total = +(internalTotal + externalTotal).toFixed(2);
      const totalHours = +(internalHoursTotal + externalHoursTotal).toFixed(2);
      return { id: String(f.id), name: feature_name, state: feature_state, values: { internal: internalValues, external: externalValues }, hours: { internal: internalHoursValues, external: externalHoursValues }, internalTotal, externalTotal, total, internalHoursTotal, externalHoursTotal, totalHours, start: f.start, end: f.end, monthsCovered, metrics: f.metrics||{}, capacity: f.capacity||[], description: f.description||'', url: f.url||'' };
    });
    // Build lookup by id
    const featById = new Map(featsPre.map(f=>[f.id, f]));

    // Now post-process epics: detect epics by presence of children (using component's expected state map if available)
    const feats = featsPre.map(fObj=>{
      // Determine children using state.childrenByEpic or by looking for features with parentEpic matching id in original project features
      let childrenIds = [];
      try{
        if(state && state.childrenByEpic && typeof state.childrenByEpic.get === 'function'){
          let raw = state.childrenByEpic.get(parseInt(fObj.id,10));
          if(!raw) raw = state.childrenByEpic.get(fObj.id);
          if(!raw) raw = state.childrenByEpic.get(String(parseInt(fObj.id,10)));
          if(Array.isArray(raw) && raw.length) childrenIds = raw.map(x=>String(x));
        }
      }catch(e){}
      if(childrenIds.length === 0){
        // fallback: search raw input features for parentEpic
          const rawMatches = (p.features||[]).filter(r=>{ try{ return (r.parentEpic || r.parentEpic === 0) && String(r.parentEpic) === String(fObj.id); }catch(e){ return false; } });
        if(rawMatches.length) childrenIds = rawMatches.map(r=>String(r.id));
      }

      if(childrenIds.length === 0){
        return fObj;
      }

      // This is an epic with children
      if(!useEpicGapFills){
          // Children override epic capacity: aggregate child monthly sums and use them as the epic values
          const children = childrenIds.map(id=>featById.get(String(id))).filter(Boolean);
          const childMonthlyInternal = Object.fromEntries(monthKeys.map(k=>[k,0]));
          const childMonthlyExternal = Object.fromEntries(monthKeys.map(k=>[k,0]));
          const childMonthlyIntH = Object.fromEntries(monthKeys.map(k=>[k,0]));
          const childMonthlyExtH = Object.fromEntries(monthKeys.map(k=>[k,0]));
          for(const c of children){
           for(const k of Object.keys(c.values.internal||{})){ childMonthlyInternal[k] += (c.values.internal[k]||0); }
           for(const k of Object.keys(c.values.external||{})){ childMonthlyExternal[k] += (c.values.external[k]||0); }
           for(const k of Object.keys(c.hours.internal||{})){ childMonthlyIntH[k] += (c.hours.internal[k]||0); }
           for(const k of Object.keys(c.hours.external||{})){ childMonthlyExtH[k] += (c.hours.external[k]||0); }
          }
          const finalInternalTotal = +(Object.values(childMonthlyInternal).reduce((a,b)=>a+b,0).toFixed(2));
          const finalExternalTotal = +(Object.values(childMonthlyExternal).reduce((a,b)=>a+b,0).toFixed(2));
          const finalTotal = +(finalInternalTotal + finalExternalTotal).toFixed(2);
          const finalIntHTotal = +(Object.values(childMonthlyIntH).reduce((a,b)=>a+b,0).toFixed(2));
          const finalExtHTotal = +(Object.values(childMonthlyExtH).reduce((a,b)=>a+b,0).toFixed(2));
          const finalTotalHours = +(finalIntHTotal + finalExtHTotal).toFixed(2);
          return Object.assign({}, fObj, { values: { internal: childMonthlyInternal, external: childMonthlyExternal }, hours: { internal: childMonthlyIntH, external: childMonthlyExtH }, internalTotal: finalInternalTotal, externalTotal: finalExternalTotal, total: finalTotal, internalHoursTotal: finalIntHTotal, externalHoursTotal: finalExtHTotal, totalHours: finalTotalHours });
      }

      // useEpicGapFills === true: compute epic costs only for months where no child covers dates
      // gather child feature objects
      const children = childrenIds.map(id=>featById.get(String(id))).filter(Boolean);
      // compute child monthly sums (internal & external)
      const childMonthlyInternal = Object.fromEntries(monthKeys.map(k=>[k,0]));
      const childMonthlyExternal = Object.fromEntries(monthKeys.map(k=>[k,0]));
      for(const c of children){ for(const k of Object.keys(c.values.internal||{})){ childMonthlyInternal[k] += (c.values.internal[k]||0); } for(const k of Object.keys(c.values.external||{})){ childMonthlyExternal[k] += (c.values.external[k]||0); } }

      // determine months the epic covers
      const epicMonths = fObj.monthsCovered || [];

      // compute average child monthly internal/external over months where children cover >0
      let childInternalSum = 0, childExternalSum = 0, monthsWithChildren = 0;
      for(const k of epicMonths){ const ci = childMonthlyInternal[k]||0; const ce = childMonthlyExternal[k]||0; if((ci+ce) > 0){ childInternalSum += ci; childExternalSum += ce; monthsWithChildren++; } }
      const avgChildInternal = monthsWithChildren ? (childInternalSum / monthsWithChildren) : 0;
      const avgChildExternal = monthsWithChildren ? (childExternalSum / monthsWithChildren) : 0;

      // If epic has its own metrics, use those per-month values on gap months (already computed in fObj.values)
      const epicInternalValues = Object.assign({}, fObj.values.internal);
      const epicExternalValues = Object.assign({}, fObj.values.external);

      // Fill gaps: for months where child monthly sum is zero, set epic month to either epic's precomputed value or estimated average based on children
      const newInternal = Object.fromEntries(monthKeys.map(k=>[k,0]));
      const newExternal = Object.fromEntries(monthKeys.map(k=>[k,0]));
      for(const k of epicMonths){ const childSum = (childMonthlyInternal[k]||0) + (childMonthlyExternal[k]||0); if(childSum > 0){ newInternal[k] = 0; newExternal[k] = 0; } else {
          // gap month
          if((epicInternalValues[k]||0) > 0 || (epicExternalValues[k]||0) > 0){ newInternal[k] = +(epicInternalValues[k]||0); newExternal[k] = +(epicExternalValues[k]||0); }
          else {
            // estimate from average child values (split by ratio)
            newInternal[k] = +(avgChildInternal || 0);
            newExternal[k] = +(avgChildExternal || 0);
          }
        } }

      // ensure rounding and totals
      const sumNewInternal = Object.values(newInternal).reduce((a,b)=>a+b,0);
      const sumNewExternal = Object.values(newExternal).reduce((a,b)=>a+b,0);
      const desiredInternalTotal = 0; // epic's own internalTotal is being used only on gaps; we leave totals as computed from months
      const desiredExternalTotal = 0;
      // final totals
      const finalInternalTotal = +(sumNewInternal.toFixed(2));
      const finalExternalTotal = +(sumNewExternal.toFixed(2));
      const finalTotal = +(finalInternalTotal + finalExternalTotal).toFixed(2);

      // hours: similar approach using epic.hours if present else average of children
      const childMonthlyIntH = Object.fromEntries(monthKeys.map(k=>[k,0]));
      const childMonthlyExtH = Object.fromEntries(monthKeys.map(k=>[k,0]));
      for(const c of children){ for(const k of Object.keys(c.hours.internal||{})){ childMonthlyIntH[k] += (c.hours.internal[k]||0); } for(const k of Object.keys(c.hours.external||{})){ childMonthlyExtH[k] += (c.hours.external[k]||0); } }
      let childIntHSum=0, childExtHSum=0, monthsWithChildH=0;
      for(const k of epicMonths){ const ch = (childMonthlyIntH[k]||0)+(childMonthlyExtH[k]||0); if(ch>0){ childIntHSum += (childMonthlyIntH[k]||0); childExtHSum += (childMonthlyExtH[k]||0); monthsWithChildH++; } }
      const avgChildIntH = monthsWithChildH ? (childIntHSum / monthsWithChildH) : 0;
      const avgChildExtH = monthsWithChildH ? (childExtHSum / monthsWithChildH) : 0;
      const newIntH = Object.fromEntries(monthKeys.map(k=>[k,0]));
      const newExtH = Object.fromEntries(monthKeys.map(k=>[k,0]));
      for(const k of epicMonths){ const ch = (childMonthlyIntH[k]||0)+(childMonthlyExtH[k]||0); if(ch>0){ newIntH[k]=0; newExtH[k]=0; } else { newIntH[k] = +(avgChildIntH||0); newExtH[k] = +(avgChildExtH||0); } }
      const finalIntHTotal = +(Object.values(newIntH).reduce((a,b)=>a+b,0).toFixed(2));
      const finalExtHTotal = +(Object.values(newExtH).reduce((a,b)=>a+b,0).toFixed(2));
      const finalTotalHours = +(finalIntHTotal + finalExtHTotal).toFixed(2);

      return Object.assign({}, fObj, { values: { internal: newInternal, external: newExternal }, hours: { internal: newIntH, external: newExtH }, internalTotal: finalInternalTotal, externalTotal: finalExternalTotal, total: finalTotal, internalHoursTotal: finalIntHTotal, externalHoursTotal: finalExtHTotal, totalHours: finalTotalHours });
    });

    // compute totals for project
    // To avoid double-counting, only sum top-level features (epics and standalone features).
    const totals = { internal: Object.fromEntries(monthKeys.map(k=>[k,0])), external: Object.fromEntries(monthKeys.map(k=>[k,0])), hours: { internal: Object.fromEntries(monthKeys.map(k=>[k,0])), external: Object.fromEntries(monthKeys.map(k=>[k,0])) } };
    let projectTotal = 0;
    let projectTotalHours = 0;
    // Determine set of all child IDs so we can skip them when summing
    const allChildIds = new Set();
    // Build child relationships from state.childrenByEpic or parentEpic in raw features
    for(const raw of (p.features||[])){
      try{
        if((raw.parentEpic || raw.parentEpic === 0)) allChildIds.add(String(raw.id));
        // also check state.childrenByEpic mapping
        if(state && state.childrenByEpic && typeof state.childrenByEpic.get === 'function'){
          const keys = [raw.id, String(raw.id), parseInt(raw.id,10)];
          for(const k of keys){ const children = state.childrenByEpic.get(k); if(Array.isArray(children)){ for(const c of children){ allChildIds.add(String(c)); } } }
        }
      }catch(e){}
    }
    for(const f of feats){
      // If this feature is a child of an epic, skip (we only want top-level epics/standalones)
      if(allChildIds.has(String(f.id))) continue;
      for(const k of Object.keys(f.values.internal||{})){ totals.internal[k] += f.values.internal[k] || 0; }
      for(const k of Object.keys(f.values.external||{})){ totals.external[k] += f.values.external[k] || 0; }
      for(const k of Object.keys(f.hours.internal||{})){ totals.hours.internal[k] += f.hours.internal[k] || 0; }
      for(const k of Object.keys(f.hours.external||{})){ totals.hours.external[k] += f.hours.external[k] || 0; }
      projectTotal += f.total || 0;
      projectTotalHours += f.totalHours || 0;
    }
    return { id: p.id, name: p.name, features: feats, totals, total: +(projectTotal.toFixed(2)), totalHours: +(projectTotalHours.toFixed(2)) };
  });
  // compute footer hours totals for quick render
  const footerHours = { internal: Object.fromEntries(monthKeys.map(k=>[k,0])), external: Object.fromEntries(monthKeys.map(k=>[k,0])) };
  let footerTotalHours = 0;
  for(const p of projectsOut || []){
    if(p.totals && p.totals.hours){
      for(const k of Object.keys(p.totals.hours.internal || {})){ footerHours.internal[k] += p.totals.hours.internal[k] || 0; }
      for(const k of Object.keys(p.totals.hours.external || {})){ footerHours.external[k] += p.totals.hours.external[k] || 0; }
    }
    footerTotalHours += +(p.totalHours || 0);
  }
  return { projects: projectsOut, footerHours, footerTotalHours };
}

export { toDate, firstOfMonth, lastOfMonth, addMonths, monthKey, monthLabel, buildMonths, buildProjects };
