import { bus } from '../core/EventBus.js';
import { FeatureEvents, CapacityEvents } from '../core/EventRegistry.js';
import { featureFlags } from '../config.js';

/**
 * FeatureService - Manages feature operations and scenario overrides
 * Phase 5.1: Extracted from state.js
 */
export class FeatureService {
  constructor(baselineStore, getActiveScenarioFn) {
    this._baselineStore = baselineStore;
    // getActiveScenarioFn can be either a function or a ScenarioManager instance
    if (typeof getActiveScenarioFn === 'function') {
      this._getActiveScenario = getActiveScenarioFn;
    } else if (getActiveScenarioFn && typeof getActiveScenarioFn.getActiveScenario === 'function') {
      this._scenarioManager = getActiveScenarioFn;
      this._getActiveScenario = () => this._scenarioManager.getActiveScenario();
    } else {
      this._getActiveScenario = () => null;
    }
    this._childrenByEpic = new Map();
  }

  /**
   * Set the children-by-epic mapping for epic constraint handling
   */
  setChildrenByEpic(childrenMap) {
    this._childrenByEpic = childrenMap;
  }

  /**
   * Get effective features with scenario overrides applied
   */
  getEffectiveFeatures() {
    // Prefer features from BaselineStore; fallback to provided baseline getter if store is empty
    const activeScenario = this._getActiveScenario();

    let baselineFeatures = this._baselineStore.getFeatures();
    
    // Apply date defaulting for features without dates when feature flag is OFF
    if (!featureFlags.SHOW_UNPLANNED_WORK) {
      baselineFeatures = this._applyDefaultDates(baselineFeatures);
    }
    
    if (!activeScenario) {
      return baselineFeatures; //.map(f => ({ ...f }));
    }

    // Merge baseline features with scenario overrides
    return baselineFeatures.map(base => {
      const ov = activeScenario.overrides ? activeScenario.overrides[base.id] : undefined;
      const effective = ov ? { ...base, ...ov, scenarioOverride: true } : { ...base };
      const derived = this._recomputeDerived(base, ov);
      effective.changedFields = derived.changedFields;
      effective.dirty = derived.dirty;
      return effective;
    });
  }

  /**
   * Get a single effective feature by id (baseline merged with active scenario override)
   * Returns null if not found.
   */
  getEffectiveFeatureById(id) {
    if (id == null) return null;

    const base = this._baselineStore.getFeatureById().get(id);
    if (!base) return null;

    const activeScenario = this._getActiveScenario();
    if (!activeScenario) return { ...base };

    const ov = activeScenario.overrides ? activeScenario.overrides[id] : undefined;
    const effective = ov ? { ...base, ...ov, scenarioOverride: true } : { ...base };
    const derived = this._recomputeDerived(base, ov);
    effective.changedFields = derived.changedFields;
    effective.dirty = derived.dirty;
    return effective;
  }

  
  /**
   * Compute derived metadata for a feature (changed fields, dirty flag)
   */
  _recomputeDerived(featureBase, override) {
    const changedFields = [];
    if (override) {
      if (override.start && override.start !== featureBase.start) changedFields.push('start');
      if (override.end && override.end !== featureBase.end) changedFields.push('end');
    }
    return { changedFields, dirty: changedFields.length > 0 };
  }

  /**
   * Update feature dates (batch operation with epic-child constraints)
   * Returns updated count
   */
  updateFeatureDates(updates, capacityCallback) {
    const prof_start = Date.now();
    const activeScenario = this._getActiveScenario();
    
    if (!activeScenario) return 0;
    if (!Array.isArray(updates) || updates.length === 0) return 0;

    const baselineFeatureById = this._baselineStore.getFeatureById();
    
    // Work on a copy of overrides to compute effective child ends
    const newOverrides = Object.assign({}, activeScenario.overrides || {});
    for (const u of updates) {
      if (!u || !u.id) continue;
      newOverrides[u.id] = { start: u.start, end: u.end };
    }

    // Apply each update with epic-child clamping and parent-epic extension handling
    let updateCount = 0;
    const changedIdsCollector = [];
    for (const u of updates) {
      if (!u || !u.id) continue;
      const id = u.id;
      const start = u.start;
      let end = u.end;
      const base = baselineFeatureById.get(id);
      if (!base) continue;

      // Epic shrink inhibition
      if (base.type === 'epic') {
        const childIds = this._childrenByEpic.get(base.id) || [];
        if (childIds.length) {
          // Compute effective ends for children using newOverrides if present
          let maxChildEnd = null;
          for (const cid of childIds) {
            const chBase = baselineFeatureById.get(cid);
            if (!chBase) continue;
            const ov = newOverrides[cid];
            const effEnd = ov && ov.end ? ov.end : chBase.end;
            if (maxChildEnd === null || effEnd > maxChildEnd) maxChildEnd = effEnd;
          }
          if (maxChildEnd && end < maxChildEnd) end = maxChildEnd;
        }
      }

      // Apply override
      const existing = activeScenario.overrides[id] || {};
      if (existing.start === start && existing.end === end) continue;
      activeScenario.overrides[id] = { start, end };
      updateCount++;
      // Track changed id
      changedIdsCollector.push(id);

      // If this is an epic move, shift children that do NOT have explicit overrides
      if (base.type === 'epic') {
        try {
          const priorEpic = activeScenario.overrides[id] || { start: base.start, end: base.end };
          const priorStart = priorEpic.start || base.start;
          const newStart = start || priorStart;
          const deltaMs = Date.parse(newStart) - Date.parse(priorStart);
          const childIds = this._childrenByEpic.get(base.id) || [];
          if (!isNaN(deltaMs) && deltaMs !== 0) {
            for (const cid of childIds) {
              const chBase = baselineFeatureById.get(cid);
              if (!chBase) continue;
              const childExistingOv = activeScenario.overrides[cid];
              const hasExplicit = childExistingOv && (childExistingOv.start !== chBase.start || childExistingOv.end !== chBase.end);
              if (hasExplicit) {
                // Do not change explicit child override, but still mark the child for refresh
                changedIdsCollector.push(cid);
                continue; // respect explicit child override
              }
              // shift child's baseline dates by delta
              const shiftIsoByMs = (iso, ms) => { try { return new Date(Date.parse(iso) + ms).toISOString().slice(0,10); } catch (e) { return iso; } };
              const shiftedStart = shiftIsoByMs(chBase.start, deltaMs);
              const shiftedEnd = shiftIsoByMs(chBase.end, deltaMs);
              activeScenario.overrides[cid] = { start: shiftedStart, end: shiftedEnd };
              changedIdsCollector.push(cid);
            }
          } else {
            // No shift, but still ensure children are refreshed so UI reflects parent change
            for (const cid of childIds) changedIdsCollector.push(cid);
          }
        } catch (e) { /* noop */ }
      }

      // If feature extends parent epic, adjust epic override
      if (base.type === 'feature' && base.parentEpic) {
        const epicId = base.parentEpic;
        const epicBase = baselineFeatureById.get(epicId);
        if (epicBase) {
          const epicOv = activeScenario.overrides[epicId] || { start: epicBase.start, end: epicBase.end };
          let changed = false;
          if (end > (epicOv.end || epicBase.end)) {
            epicOv.end = end;
            changed = true;
          }
          if (start < (epicOv.start || epicBase.start)) {
            epicOv.start = start;
            changed = true;
          }
          if (changed) {
            activeScenario.overrides[epicId] = epicOv;
            newOverrides[epicId] = epicOv;
            // Ensure epic is re-rendered
            changedIdsCollector.push(epicId);
          }
        }
      }
    }

    if (updateCount > 0) {
      activeScenario.isChanged = true;

      // If an epic itself was updated, include its children so the board
      // can update their visuals if necessary.
      // (changedIdsCollector may already contain epic ids from above)
      for (const cid of Array.from(changedIdsCollector)) {
        // If cid is an epic, add its children
        const childIds = this._childrenByEpic.get(cid) || [];
        if (childIds && childIds.length) changedIdsCollector.push(...childIds);
      }

      // Collect changed ids to allow consumers to update only affected cards
      const changedIds = Array.from(new Set(changedIdsCollector.filter(Boolean)));

      //console.log('updateFeatureDatesBulk updated ids:', changedIds);

      // Emit events with explicit ids so listeners can do minimal updates
      bus.emit(FeatureEvents.UPDATED, { ids: changedIds });

      // Trigger capacity recalculation if callback provided
      if (capacityCallback) {
        capacityCallback();
      }
    }

    //console.log('updateFeatureDatesBulk prof time:', Date.now() - prof_start);
    return updateCount;
  }

  /**
   * Update a single feature field (scenario override)
   */
  updateFeatureField(id, field, value, capacityCallback) {
    const activeScenario = this._getActiveScenario();
    if (!activeScenario) return false;

    const baselineFeatures = this._baselineStore.getFeatures();
    const base = baselineFeatures.find(f => f.id === id);
    if (!base) return false;

    // Only supporting date fields for overrides right now
    if (field === 'start' || field === 'end') {
      const ov = activeScenario.overrides[id] || { start: base.start, end: base.end };
      ov[field] = value;
      activeScenario.overrides[id] = ov;
      activeScenario.isChanged = true;

      // Emit events with specific id so board can update only changed cards
      // Also include parent epic or children where relevant so all affected
      // cards receive updated `feature` data (dirty flags, dates).
      const idsToEmit = new Set([id]);
      if (base.type === 'feature' && base.parentEpic) idsToEmit.add(base.parentEpic);
      if (base.type === 'epic') {
        const childIds = this._childrenByEpic.get(base.id) || [];
        for (const cid of childIds) idsToEmit.add(cid);
      }
      bus.emit(FeatureEvents.UPDATED, { ids: Array.from(idsToEmit) });

      // Trigger capacity recalculation if callback provided
      if (capacityCallback) {
        capacityCallback();
      }

      return true;
    }

    return false;
  }

  /**
   * Revert feature to baseline (remove scenario override)
   */
  revertFeature(id, capacityCallback) {
    const activeScenario = this._getActiveScenario();
    if (!activeScenario) return false;

    if (activeScenario.overrides[id]) {
      delete activeScenario.overrides[id];
      activeScenario.isChanged = true;

      // Emit events and include related ids (parent/children)
      const idsToEmit = new Set([id]);
      const base = this._baselineStore.getFeatureById().get(id);
      if (base) {
        if (base.type === 'feature' && base.parentEpic) idsToEmit.add(base.parentEpic);
        if (base.type === 'epic') { const childIds = this._childrenByEpic.get(base.id) || []; for (const cid of childIds) idsToEmit.add(cid); }
      }
      bus.emit(FeatureEvents.UPDATED, { ids: Array.from(idsToEmit) });

      // Trigger capacity recalculation if callback provided
      if (capacityCallback) {
        capacityCallback();
      }

      return true;
    }

    return false;
  }

  /**
   * Get feature title by ID (helper)
   */
  getFeatureTitleById(id) {
    const baselineFeatures = this._baselineStore.getFeatures();
    const f = baselineFeatures.find(x => x.id === id);
    return f ? f.title : id;
  }

  /**
   * Apply default dates to features without start/end dates
   * Used when SHOW_UNPLANNED_WORK feature flag is OFF
   * Mimics backend behavior: today-120 to today-90
   * @private
   */
  _applyDefaultDates(features) {
    const today = new Date();
    const todayMinus120 = new Date(today);
    todayMinus120.setDate(today.getDate() - 120);
    const todayMinus90 = new Date(today);
    todayMinus90.setDate(today.getDate() - 90);
    
    const defaultStart = todayMinus120.toISOString().split('T')[0];
    const defaultEnd = todayMinus90.toISOString().split('T')[0];
    
    return features.map(f => {
      // Only add default dates if both start and end are missing
      if (!f.start || !f.end) {
        return {
          ...f,
          start: f.start || defaultStart,
          end: f.end || defaultEnd,
          hasDefaultDates: true // Mark for potential future use
        };
      }
      return f;
    });
  }
}

