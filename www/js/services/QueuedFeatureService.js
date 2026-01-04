import { bus } from '../core/EventBus.js';
import { FeatureEvents } from '../core/EventRegistry.js';
import { featureFlags } from '../config.js';

/**
 * QueuedFeatureService - experimental queued/idle processing wrapper around FeatureService
 * Mirrors the public API of FeatureService so it can be swapped in safely.
 */
export class QueuedFeatureService {
  constructor(baselineStore, getActiveScenarioFn) {
    // Delegate to the original FeatureService implementation where possible
    // to avoid duplicating behavior. Import dynamically to keep file isolated.
    this._baselineStore = baselineStore;
    if (typeof getActiveScenarioFn === 'function') {
      this._getActiveScenario = getActiveScenarioFn;
    } else if (getActiveScenarioFn && typeof getActiveScenarioFn.getActiveScenario === 'function') {
      this._scenarioManager = getActiveScenarioFn;
      this._getActiveScenario = () => this._scenarioManager.getActiveScenario();
    } else {
      this._getActiveScenario = () => null;
    }
    this._childrenByEpic = new Map();
    this._updateQueue = [];
    this._processingQueue = false;
    this._pendingCapacityCallbacks = [];
  }

  setChildrenByEpic(childrenMap) { this._childrenByEpic = childrenMap; }

  setProjectTeamService(projectTeamService) { this._projectTeamService = projectTeamService; }

  getEffectiveFeatures() {
    // fallback simple implementation: mirror baseline + overrides
    let baselineFeatures = [];
    try { baselineFeatures = (this._baselineStore && typeof this._baselineStore.getFeatures === 'function') ? this._baselineStore.getFeatures() : []; } catch(e){ baselineFeatures = []; }
    const activeScenario = this._getActiveScenario();
    if(!activeScenario) return baselineFeatures.map(f=>({...f}));
    return baselineFeatures.map(base => {
      const ov = activeScenario.overrides ? activeScenario.overrides[base.id] : undefined;
      const effective = ov ? { ...base, ...ov, scenarioOverride: true } : { ...base };
      const derived = this._recomputeDerived(base, ov);
      effective.changedFields = derived.changedFields;
      effective.dirty = derived.dirty;
      
      // Always recalculate orgLoad based on effective capacity to ensure it's current
      if (this._projectTeamService && effective.capacity) {
        effective.orgLoad = this._projectTeamService.computeFeatureOrgLoad(effective);
      }
      
      return effective;
    });
  }

  _recomputeDerived(featureBase, override) {
    const changedFields = [];
    if (override) {
      if (override.start && override.start !== featureBase.start) changedFields.push('start');
      if (override.end && override.end !== featureBase.end) changedFields.push('end');
      if (override.capacity && JSON.stringify(override.capacity) !== JSON.stringify(featureBase.capacity)) changedFields.push('capacity');
    }
    return { changedFields, dirty: changedFields.length > 0 };
  }

  setChildrenByEpic(childrenMap) { this._childrenByEpic = childrenMap; }

  // Simple pass-through for single-field updates (no queue)
  updateFeatureField(id, field, value, capacityCallback) {
    const activeScenario = this._getActiveScenario();
    if(!activeScenario) return false;
    const baselineFeatures = this._baselineStore.getFeatures();
    const base = baselineFeatures.find(f => f.id === id);
    if(!base) return false;
    if(field === 'start' || field === 'end'){
      const ov = activeScenario.overrides[id] || { start: base.start, end: base.end };
      ov[field] = value;
      activeScenario.overrides[id] = ov;
      activeScenario.isChanged = true;
      try{ bus.emit(FeatureEvents.UPDATED, { ids: [id] }); }catch(e){ bus.emit(FeatureEvents.UPDATED); }
      if(capacityCallback){ try{ setTimeout(()=>{ try{ capacityCallback(); }catch(e){} },0);}catch(e){ try{ capacityCallback(); }catch(e){} } }
      return true;
    }
    if(field === 'capacity'){
      const ov = activeScenario.overrides[id] || {};
      ov.capacity = value;
      activeScenario.overrides[id] = ov;
      activeScenario.isChanged = true;
      try{ bus.emit(FeatureEvents.UPDATED, { ids: [id] }); }catch(e){ bus.emit(FeatureEvents.UPDATED); }
      if(capacityCallback){ try{ setTimeout(()=>{ try{ capacityCallback(); }catch(e){} },0);}catch(e){ try{ capacityCallback(); }catch(e){} } }
      return true;
    }
    return false;
  }

  revertFeature(id, capacityCallback){
    const activeScenario = this._getActiveScenario();
    if(!activeScenario) return false;
    if(activeScenario.overrides[id]){ delete activeScenario.overrides[id]; activeScenario.isChanged = true; try{ bus.emit(FeatureEvents.UPDATED, { ids: [id] }); }catch(e){ bus.emit(FeatureEvents.UPDATED); } if(capacityCallback){ try{ setTimeout(()=>{ try{ capacityCallback(); }catch(e){} },0);}catch(e){ try{ capacityCallback(); }catch(e){} } } return true; }
    return false;
  }

  // The queued update path: lightweight optimistic apply + idle processing
  updateFeatureDates(updates, capacityCallback){
    if (!Array.isArray(updates) || updates.length === 0) return 0;
    const activeScenario = this._getActiveScenario();
    if(!activeScenario) return 0;
    for(const u of updates){ if(u && u.id) this._updateQueue.push(u); }
    if(typeof capacityCallback === 'function') this._pendingCapacityCallbacks.push(capacityCallback);
    // Optimistic quick apply (mirror original behavior): apply overrides immediately
    const actuallyAppliedQuickIds = [];
    try{
      const baselineFeatureById = this._baselineStore.getFeatureById();
      for(const u of updates){ if(u && u.id){
          const base = baselineFeatureById.get(u.id);
          const baseline = base ? { start: base.start, end: base.end } : { start: null, end: null };
          const existing = activeScenario.overrides[u.id];
          const existingIsExplicit = existing && (existing.start !== baseline.start || existing.end !== baseline.end);

          // If this update originates from an epic move and the feature already
          // has an explicit override, do not overwrite it optimistically.
          if(u.fromEpicMove && existingIsExplicit){
            if(featureFlags && featureFlags.serviceInstrumentation){ try{ console.log('[QueuedFeatureService] skipping optimistic overwrite for', u.id, 'fromEpicMove because explicit override exists', existing); }catch(e){} }
          } else {
            // If this is an epic, remember its prior effective start so queued processing
            // can compute deltas against the pre-optimistic value (avoids cumulative shifts).
            if(base && base.type === 'epic'){
              this._priorEpicStart = this._priorEpicStart || new Map();
              const prevEpic = activeScenario.overrides[u.id] || { start: base.start, end: base.end };
              this._priorEpicStart.set(u.id, prevEpic.start);
              // Apply optimistic overrides to all children by shifting them by the epic delta
              try{
                const epicActiveStart = prevEpic.start || base.start;
                const epicNewStart = u.start || epicActiveStart;
                const deltaMs = Date.parse(epicNewStart) - Date.parse(epicActiveStart);
                const shiftIsoByMs = (iso, ms) => { try{ return new Date(Date.parse(iso) + ms).toISOString().slice(0,10); }catch(e){ return iso; } };
                let minChildStart = null; let maxChildEnd = null;
                if(!isNaN(deltaMs) && deltaMs !== 0){
                  const childIds = this._childrenByEpic.get(base.id) || [];
                  for(const cid of childIds){
                    const chBase = baselineFeatureById.get(cid);
                    if(!chBase) continue;
                        const existingChildOv = activeScenario.overrides ? activeScenario.overrides[cid] : undefined;
                        const existingChild = existingChildOv || { start: chBase.start, end: chBase.end };
                        const hasExplicitChild = existingChildOv && (existingChildOv.start !== chBase.start || existingChildOv.end !== chBase.end);
                        if(hasExplicitChild){
                          if(featureFlags && featureFlags.serviceInstrumentation){ try{ console.log('[QueuedFeatureService] skipping optimistic overwrite for', cid, 'fromEpicMove because explicit override exists', existingChildOv); }catch(e){} }
                          // respect explicit override, don't apply optimistic shift
                          if(minChildStart === null || existingChild.start < minChildStart) minChildStart = existingChild.start;
                          if(maxChildEnd === null || existingChild.end > maxChildEnd) maxChildEnd = existingChild.end;
                          continue;
                        }
                        const shiftedStart = shiftIsoByMs(existingChild.start, deltaMs);
                        const shiftedEnd = shiftIsoByMs(existingChild.end, deltaMs);
                        activeScenario.overrides[cid] = { start: shiftedStart, end: shiftedEnd };
                        actuallyAppliedQuickIds.push(cid);
                    if(minChildStart === null || shiftedStart < minChildStart) minChildStart = shiftedStart;
                    if(maxChildEnd === null || shiftedEnd > maxChildEnd) maxChildEnd = shiftedEnd;
                  }
                } else {
                  // No delta; calculate current child extremes from overrides/baseline
                  const childIds = this._childrenByEpic.get(base.id) || [];
                  for(const cid of childIds){
                    const chBase = baselineFeatureById.get(cid);
                    if(!chBase) continue;
                    const existingChild = activeScenario.overrides[cid] || { start: chBase.start, end: chBase.end };
                    if(minChildStart === null || existingChild.start < minChildStart) minChildStart = existingChild.start;
                    if(maxChildEnd === null || existingChild.end > maxChildEnd) maxChildEnd = existingChild.end;
                  }
                }

                // Compute optimistic epic bounds: prefer the candidate (u.start/u.end) when present
                // so epic moves/changes are reflected immediately, but still ensure epic
                // does not shrink inside its children by including child extremes.
                const baselineEpicStart = base.start;
                const baselineEpicEnd = base.end;
                const candidateStart = u.start || baselineEpicStart;
                const candidateEnd = u.end || baselineEpicEnd;
                const startCandidates = [candidateStart, minChildStart].filter(Boolean);
                const endCandidates = [candidateEnd, maxChildEnd].filter(Boolean);
                // If candidate missing, fall back to baseline
                if (startCandidates.length === 0) startCandidates.push(baselineEpicStart);
                if (endCandidates.length === 0) endCandidates.push(baselineEpicEnd);
                const finalStart = startCandidates.length ? startCandidates.reduce((a,b)=> a < b ? a : b) : candidateStart;
                const finalEnd = endCandidates.length ? endCandidates.reduce((a,b)=> a > b ? a : b) : candidateEnd;

                activeScenario.overrides[u.id] = { start: finalStart, end: finalEnd };
                actuallyAppliedQuickIds.push(u.id);
              }catch(e){
                // Fallback behavior: apply candidate directly
                activeScenario.overrides[u.id] = { start: u.start, end: u.end };
                actuallyAppliedQuickIds.push(u.id);
              }
            }
          }

          // If this feature has a parent epic, adjust parent optimistically (earlier start or later end)
          try{
            if(base && base.type === 'feature' && base.parentEpic){
              const epicId = base.parentEpic;
              const epicBase = baselineFeatureById.get(epicId);
              if(epicBase){
                const existingEpicOv = activeScenario.overrides[epicId] || { start: epicBase.start, end: epicBase.end };
                let changed = false;
                if(u.end && (existingEpicOv.end || epicBase.end) < u.end){ existingEpicOv.end = u.end; changed = true; }
                if(u.start && (existingEpicOv.start || epicBase.start) > u.start){ existingEpicOv.start = u.start; changed = true; }
                if(changed){ activeScenario.overrides[epicId] = existingEpicOv; actuallyAppliedQuickIds.push(epicId); }
              }
            }
          }catch(e){}
        } }
      const dedup = Array.from(new Set(actuallyAppliedQuickIds));
      try{ if(dedup.length) bus.emit(FeatureEvents.UPDATED, { ids: dedup }); else bus.emit(FeatureEvents.UPDATED); }catch(e){ bus.emit(FeatureEvents.UPDATED); }
    }catch(e){}
    activeScenario.isChanged = true;
    // Schedule processing
    this._scheduleProcessQueue();
    return updates.length;
  }

  _scheduleProcessQueue(){
    if(this._processingQueue) return;
    this._processingQueue = true;
    const process = ()=>{
      this._processingQueue = false;
      if(!this._updateQueue || this._updateQueue.length === 0) return;
      const items = this._updateQueue.splice(0);
      const pendingCallbacks = this._pendingCapacityCallbacks.splice(0);
      const baselineFeatureById = this._baselineStore.getFeatureById();
      const activeScenario = this._getActiveScenario(); if(!activeScenario) return;

      // Seed newOverrides with queued values so epic processing sees child queued updates
      const newOverrides = Object.assign({}, activeScenario.overrides || {});
      for(const u of items){ if(u && u.id && u.start !== undefined && u.end !== undefined) newOverrides[u.id] = { start: u.start, end: u.end }; }

      const appliedIds = [];

      // Build lastById map and process features first, then epics (children before parents)
      const lastById = new Map(); for(const u of items){ if(u && u.id) lastById.set(u.id, u); }
      const featureIds = []; const epicIds = [];
      for(const [id, upd] of lastById.entries()){ const base = baselineFeatureById.get(id); if(!base) continue; if(base.type === 'epic') epicIds.push(id); else featureIds.push(id); }
      const processOrder = [...featureIds, ...epicIds];
      for(const id of processOrder){ const upd = lastById.get(id); if(!upd) continue; const base = baselineFeatureById.get(id); if(!base) continue;
        let start = upd.start; let end = upd.end;

        if(base.type === 'epic'){
          const childIds = this._childrenByEpic.get(base.id) || [];
          if(childIds.length){
            // If epic itself was queued/moved, shift children by the same delta
            const epicQueued = lastById.get(base.id);
            let epicMovedDeltaMs = null;
            if(epicQueued && epicQueued.start){
                try{
                  // Compute delta against the epic's current active override (if any)
                  const activeEpicOv = activeScenario.overrides[base.id] || { start: base.start, end: base.end };
                  const activeEpicStart = activeEpicOv.start || base.start;
                    epicMovedDeltaMs = Date.parse(epicQueued.start) - Date.parse(activeEpicStart);
                    // Once we've used the prior start to compute delta, forget it so
                    // subsequent queued batches compute delta relative to the latest state.
                    if(this._priorEpicStart) this._priorEpicStart.delete(base.id);
                }catch(e){ epicMovedDeltaMs = null; }
            }

            // helper to shift ISO date by ms
            const shiftIsoByMs = (iso, ms) => { try{ return new Date(Date.parse(iso) + ms).toISOString().slice(0,10); }catch(e){ return iso; } };

            let maxChildEnd = null;
            let minChildStart = null;
            for(const cid of childIds){
              const chBase = baselineFeatureById.get(cid);
              if(!chBase) continue;

              // If epic was moved, apply shifted override for children that do not have explicit overrides
              if(epicMovedDeltaMs !== null){
                  // Shift children by the epic delta, but do NOT overwrite children
                  // that already have explicit overrides (preserve explicit overrides).
                  const chBase = baselineFeatureById.get(cid);
                  const existingChildOv = activeScenario.overrides ? activeScenario.overrides[cid] : undefined;
                  const hasExplicit = existingChildOv && (existingChildOv.start !== chBase.start || existingChildOv.end !== chBase.end);
                  if(hasExplicit){
                    // respect explicit override
                    const existingChild = existingChildOv || { start: chBase.start, end: chBase.end };
                    if(maxChildEnd === null || existingChild.end > maxChildEnd) maxChildEnd = existingChild.end;
                    if(minChildStart === null || existingChild.start < minChildStart) minChildStart = existingChild.start;
                    continue;
                  }
                  const existingChild = { start: chBase.start, end: chBase.end };
                  const shiftedStart = shiftIsoByMs(existingChild.start, epicMovedDeltaMs);
                  const shiftedEnd = shiftIsoByMs(existingChild.end, epicMovedDeltaMs);
                  activeScenario.overrides[cid] = { start: shiftedStart, end: shiftedEnd };
                  newOverrides[cid] = { start: shiftedStart, end: shiftedEnd };
                  if(!appliedIds.includes(cid)) appliedIds.push(cid);
                  if(maxChildEnd === null || shiftedEnd > maxChildEnd) maxChildEnd = shiftedEnd;
                  if(minChildStart === null || shiftedStart < minChildStart) minChildStart = shiftedStart;
                  continue;
              }

              const ovNew = newOverrides[cid];
              const ovActive = activeScenario.overrides ? activeScenario.overrides[cid] : undefined;
              const effStart = (ovNew && ovNew.start) ? ovNew.start : (ovActive && ovActive.start ? ovActive.start : chBase.start);
              const effEnd = (ovNew && ovNew.end) ? ovNew.end : (ovActive && ovActive.end ? ovActive.end : chBase.end);
              if(maxChildEnd === null || effEnd > maxChildEnd) maxChildEnd = effEnd;
              if(minChildStart === null || effStart < minChildStart) minChildStart = effStart;
            }

            // Determine the candidate epic bounds. Use queued values if present, otherwise
            // fall back to the active override (if any) or baseline. Then, enforce the rule
            // that the epic should never be shrunk inside its children: if any child
            // starts earlier than the epic, adopt the earliest child start; if any child
            // ends later than the epic, adopt the latest child end.
            // Use baseline epic bounds to enforce DON'T-SHRINK: if the epic baseline
            // already spans beyond its children, preserve those baseline bounds.
            const baselineEpicStart = base.start;
            const baselineEpicEnd = base.end;
            const candidateStart = (start !== undefined && start !== null) ? start : baselineEpicStart;
            const candidateEnd = (end !== undefined && end !== null) ? end : baselineEpicEnd;
            // If the epic itself was queued (epicQueued exists), prefer the queued candidate bounds
            // but still enforce that the epic must include any child extremes (don't let candidate shrink inside children).
            if (epicQueued) {
              const startCandidates = [candidateStart, minChildStart].filter(Boolean);
              const endCandidates = [candidateEnd, maxChildEnd].filter(Boolean);
              start = startCandidates.length ? startCandidates.reduce((a,b)=> a < b ? a : b) : candidateStart;
              end = endCandidates.length ? endCandidates.reduce((a,b)=> a > b ? a : b) : candidateEnd;
            } else {
              // No epic queued; preserve baseline and ensure it covers children
              const startCandidates = [baselineEpicStart, candidateStart, minChildStart].filter(Boolean);
              const endCandidates = [baselineEpicEnd, candidateEnd, maxChildEnd].filter(Boolean);
              start = startCandidates.length ? startCandidates.reduce((a,b)=> a < b ? a : b) : candidateStart;
              end = endCandidates.length ? endCandidates.reduce((a,b)=> a > b ? a : b) : candidateEnd;
            }
          }
        }

        const existing = activeScenario.overrides[id] || {};
        // If this update originated from an epic move and the child already has an explicit override, skip overwriting it
        const baseline = baselineFeatureById.get(id) || {};
        const existingIsExplicit = existing && (existing.start !== baseline.start || existing.end !== baseline.end);
        if(upd && upd.fromEpicMove && existingIsExplicit){
          // skip applying epic-derived child update
          continue;
        }

        if(existing.start === start && existing.end === end) continue;
        activeScenario.overrides[id] = { start, end };
        newOverrides[id] = { start, end };
        appliedIds.push(id);

        if(base.type === 'feature' && base.parentEpic){
          const epicId = base.parentEpic;
          const epicBase = baselineFeatureById.get(epicId);
          if(epicBase){
            const epicOv = activeScenario.overrides[epicId] || { start: epicBase.start, end: epicBase.end };
            let changed = false;
            if(end > (epicOv.end || epicBase.end)) { epicOv.end = end; changed = true; }
            if(start < (epicOv.start || epicBase.start)) { epicOv.start = start; changed = true; }
            if(changed){ activeScenario.overrides[epicId] = epicOv; newOverrides[epicId] = epicOv; if(!appliedIds.includes(epicId)) appliedIds.push(epicId); }
          }
        }
      }

      if(appliedIds.length){ try{ bus.emit(FeatureEvents.UPDATED, { ids: Array.from(new Set(appliedIds)) }); }catch(e){ bus.emit(FeatureEvents.UPDATED); } }
      for(const cb of pendingCallbacks){ try{ setTimeout(()=>{ try{ cb(); }catch(e){} },0); }catch(e){ try{ cb(); }catch(e){} } }
    };
    if(typeof requestIdleCallback === 'function'){ try{ requestIdleCallback(process, { timeout: 200 }); }catch(e){ setTimeout(process, 50); } } else { setTimeout(process, 50); }
  }
}
