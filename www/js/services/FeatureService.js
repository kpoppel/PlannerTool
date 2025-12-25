import { bus } from '../core/EventBus.js';
import { FeatureEvents, CapacityEvents } from '../core/EventRegistry.js';

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
          }
        }
      }
    }

    if (updateCount > 0) {
      activeScenario.isChanged = true;
      
      // Emit events
      bus.emit(FeatureEvents.UPDATED);
      
      // Trigger capacity recalculation if callback provided
      if (capacityCallback) {
        capacityCallback();
      }
    }

    console.log('updateFeatureDatesBulk prof time:', Date.now() - prof_start);
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

      // Emit events
      bus.emit(FeatureEvents.UPDATED);

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

      // Emit events
      bus.emit(FeatureEvents.UPDATED);

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
}
