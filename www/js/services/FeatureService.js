import { bus } from '../core/EventBus.js';
import { FeatureEvents } from '../core/EventRegistry.js';
import { featureFlags } from '../config.js';

/**
 * FeatureService - Manages feature operations and scenario overrides
 */
export class FeatureService {
  constructor(baselineStore, getActiveScenarioFn) {
    this._baselineStore = baselineStore;
    // getActiveScenarioFn can be either a function or a ScenarioManager instance
    if (typeof getActiveScenarioFn === 'function') {
      this._getActiveScenario = getActiveScenarioFn;
    } else if (
      getActiveScenarioFn &&
      typeof getActiveScenarioFn.getActiveScenario === 'function'
    ) {
      this._scenarioManager = getActiveScenarioFn;
      this._getActiveScenario = () => this._scenarioManager.getActiveScenario();
    } else {
      this._getActiveScenario = () => null;
    }
    this._childrenByParent = new Map();
    // Cache for aggregated counts to avoid repeated expensive traversals
    this._countsCache = null;

    // Invalidate cached counts when features change elsewhere
    bus.on(FeatureEvents.UPDATED, () => this.invalidateCounts());
  }

  /**
   * Invalidate cached aggregated counts
   */
  invalidateCounts() {
    this._countsCache = null;
  }

  /**
   * Compute aggregated counts per task type for projects and teams in a single pass.
   * Returns an object { projectCounts: Map<projectId, Map<type, count>>,
   *                      teamCounts: Map<teamId, Map<type, count>> }
   */
  _ensureCounts() {
    if (this._countsCache) return this._countsCache;
    const projectCounts = new Map();
    const teamCounts = new Map();

    const feats = this.getEffectiveFeatures() || [];
    for (const f of feats) {
      const projId = f.project || '__unknown__';
      const type = String(f.type || '__unknown__').toLowerCase();
      if (!projectCounts.has(projId)) projectCounts.set(projId, new Map());
      const projMap = projectCounts.get(projId);
      projMap.set(type, (projMap.get(type) || 0) + 1);

      // For team-level counts, count each item once per team if it has
      // any non-zero allocation for that team (avoid double-counting).
      if (Array.isArray(f.capacity)) {
        const seen = new Set();
        for (const tl of f.capacity) {
          if (!tl || !tl.team) continue;
          const cap = Number(tl.capacity) || 0;
          if (cap <= 0) continue;
          const teamId = tl.team;
          if (seen.has(teamId)) continue;
          seen.add(teamId);
          if (!teamCounts.has(teamId)) teamCounts.set(teamId, new Map());
          const teamMap = teamCounts.get(teamId);
          teamMap.set(type, (teamMap.get(type) || 0) + 1);
        }
      }
    }

    this._countsCache = { projectCounts, teamCounts };
    return this._countsCache;
  }

  /**
   * Set the children-by-epic mapping for epic constraint handling
   */
  setChildrenByParent(childrenMap) {
    this._childrenByParent = childrenMap;
  }

  /**
   * Set the ProjectTeamService for orgLoad calculations
   */
  setProjectTeamService(projectTeamService) {
    this._projectTeamService = projectTeamService;
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
    return baselineFeatures.map((base) => {
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

    console.log(
      '[FeatureService] getEffectiveFeatureById',
      id,
      'override:',
      ov,
      'changedFields:',
      derived.changedFields,
      'dirty:',
      derived.dirty
    );

    // Always recalculate orgLoad based on effective capacity to ensure it's current
    if (this._projectTeamService && effective.capacity) {
      effective.orgLoad = this._projectTeamService.computeFeatureOrgLoad(effective);
    }

    return effective;
  }

  /**
   * Compute derived metadata for a feature (changed fields, dirty flag)
   */
  _recomputeDerived(featureBase, override) {
    const changedFields = [];
    if (override) {
      if (override.start && override.start !== featureBase.start)
        changedFields.push('start');
      if (override.end && override.end !== featureBase.end) changedFields.push('end');
      if (
        override.capacity &&
        JSON.stringify(override.capacity) !== JSON.stringify(featureBase.capacity)
      )
        changedFields.push('capacity');
      // Support state override detection
      const baseState = featureBase.state || '';
      if (override.state && override.state !== baseState) changedFields.push('state');
    }
    return { changedFields, dirty: changedFields.length > 0 };
  }

  /**
   * Update feature dates (batch operation with epic-child constraints)
   * Returns updated count
   */
  updateFeatureDates(updates, capacityCallback) {
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

      // Parent shrink inhibition: prevent dates from shrinking past children's end dates
      const _shrinkChildIds = this._childrenByParent.get(base.id) || [];
      if (_shrinkChildIds.length > 0) {
        // Compute effective ends for children using newOverrides if present
        let maxChildEnd = null;
        for (const cid of _shrinkChildIds) {
          const chBase = baselineFeatureById.get(cid);
          if (!chBase) continue;
          const ov = newOverrides[cid];
          const effEnd = ov && ov.end ? ov.end : chBase.end;
          if (maxChildEnd === null || effEnd > maxChildEnd) maxChildEnd = effEnd;
        }
        if (maxChildEnd && end < maxChildEnd) end = maxChildEnd;
      }

      // Apply override - merge with any existing override so we don't drop other
      // fields (like capacity) when updating dates.
      const existing = activeScenario.overrides[id] || {
        start: base.start,
        end: base.end,
      };
      if (existing.start === start && existing.end === end) continue;
      existing.start = start;
      existing.end = end;
      activeScenario.overrides[id] = existing;
      updateCount++;
      // Track changed id
      changedIdsCollector.push(id);

      // If this is an epic move, shift children that do NOT have explicit overrides
      if ((this._childrenByParent.get(base.id) || []).length > 0) {
        try {
          const priorEpic = activeScenario.overrides[id] || {
            start: base.start,
            end: base.end,
          };
          const priorStart = priorEpic.start || base.start;
          const newStart = start || priorStart;
          const deltaMs = Date.parse(newStart) - Date.parse(priorStart);
          const childIds = this._childrenByParent.get(base.id) || [];
          if (!isNaN(deltaMs) && deltaMs !== 0) {
            for (const cid of childIds) {
              const chBase = baselineFeatureById.get(cid);
              if (!chBase) continue;
              const childExistingOv = activeScenario.overrides[cid];
              const hasExplicit =
                childExistingOv &&
                (childExistingOv.start !== chBase.start ||
                  childExistingOv.end !== chBase.end);
              if (hasExplicit) {
                // Do not change explicit child override, but still mark the child for refresh
                changedIdsCollector.push(cid);
                continue; // respect explicit child override
              }
              // shift child's baseline dates by delta
              const shiftIsoByMs = (iso, ms) => {
                try {
                  return new Date(Date.parse(iso) + ms).toISOString().slice(0, 10);
                } catch (e) {
                  return iso;
                }
              };
              const shiftedStart = shiftIsoByMs(chBase.start, deltaMs);
              const shiftedEnd = shiftIsoByMs(chBase.end, deltaMs);
              // Merge with any existing override to preserve other fields (e.g., capacity)
              const childOv = activeScenario.overrides[cid] || {
                start: chBase.start,
                end: chBase.end,
              };
              childOv.start = shiftedStart;
              childOv.end = shiftedEnd;
              activeScenario.overrides[cid] = childOv;
              changedIdsCollector.push(cid);
            }
          } else {
            // No shift, but still ensure children are refreshed so UI reflects parent change
            for (const cid of childIds) changedIdsCollector.push(cid);
          }
        } catch (e) {
          /* noop */
        }
      }

      // If feature extends parent epic, adjust epic override
      if (base.parentId) {
        const epicId = base.parentId;
        const epicBase = baselineFeatureById.get(epicId);
        if (epicBase) {
          const epicOv = activeScenario.overrides[epicId] || {
            start: epicBase.start,
            end: epicBase.end,
          };
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
        const childIds = this._childrenByParent.get(cid) || [];
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
    const base = baselineFeatures.find((f) => f.id === id);
    if (!base) return false;

    // Support date and capacity fields for overrides
    if (field === 'start' || field === 'end') {
      const ov = activeScenario.overrides[id] || {
        start: base.start,
        end: base.end,
      };
      ov[field] = value;
      activeScenario.overrides[id] = ov;
      activeScenario.isChanged = true;

      // Emit events with specific id so board can update only changed cards
      // Also include parent epic or children where relevant so all affected
      // cards receive updated `feature` data (dirty flags, dates).
      const idsToEmit = new Set([id]);
      if (base.parentId) idsToEmit.add(base.parentId);
      if ((this._childrenByParent.get(base.id) || []).length > 0) {
        const childIds = this._childrenByParent.get(base.id) || [];
        for (const cid of childIds) idsToEmit.add(cid);
      }
      bus.emit(FeatureEvents.UPDATED, { ids: Array.from(idsToEmit) });

      // Trigger capacity recalculation if callback provided
      if (capacityCallback) {
        capacityCallback();
      }

      return true;
    }

    if (field === 'capacity') {
      const ov = activeScenario.overrides[id] || {};
      ov.capacity = value;
      activeScenario.overrides[id] = ov;
      activeScenario.isChanged = true;

      // Emit events so UI updates
      const idsToEmit = new Set([id]);
      if (base.parentId) idsToEmit.add(base.parentId);
      bus.emit(FeatureEvents.UPDATED, { ids: Array.from(idsToEmit) });

      // Trigger capacity recalculation if callback provided
      if (capacityCallback) {
        capacityCallback();
      }

      return true;
    }

    if (field === 'state' || field === 'status') {
      const ov = activeScenario.overrides[id] || {};
      ov.state = value;
      activeScenario.overrides[id] = ov;
      activeScenario.isChanged = true;

      // Emit events so UI updates
      const idsToEmit = new Set([id]);
      if (base.parentId) idsToEmit.add(base.parentId);
      bus.emit(FeatureEvents.UPDATED, { ids: Array.from(idsToEmit) });

      // State change may affect derived color mappings; trigger no capacity callback
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
        if (base.parentId) idsToEmit.add(base.parentId);
        if ((this._childrenByParent.get(base.id) || []).length > 0) {
          const childIds = this._childrenByParent.get(base.id) || [];
          for (const cid of childIds) idsToEmit.add(cid);
        }
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
    const f = baselineFeatures.find((x) => x.id === id);
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

    return features.map((f) => {
      // Only add default dates if both start and end are missing
      if (!f.start || !f.end) {
        return {
          ...f,
          start: f.start || defaultStart,
          end: f.end || defaultEnd,
          hasDefaultDates: true, // Mark for potential future use
        };
      }
      return f;
    });
  }

  /**
   * Count epics for a given project id (backward-compat shim)
   */
  countEpicsForProject(projectId) {
    return this.allCountsForProject(projectId).get('epic') || 0;
  }

  /**
   * Count features for a given project id (backward-compat shim)
   */
  countFeaturesForProject(projectId) {
    return this.allCountsForProject(projectId).get('feature') || 0;
  }

  /**
   * Count epics that have non-zero allocation for a team (backward-compat shim)
   */
  countEpicsForTeam(teamId) {
    return this.allCountsForTeam(teamId).get('epic') || 0;
  }

  /**
   * Count items of any type that have non-zero allocation for a team (backward-compat shim)
   */
  countFeaturesForTeam(teamId) {
    return this.allCountsForTeam(teamId).get('feature') || 0;
  }

  /**
   * Return a Map<type, count> for all task types in a given project.
   * @param {string} projectId
   * @returns {Map<string, number>}
   */
  allCountsForProject(projectId) {
    const counts = this._ensureCounts();
    return counts.projectCounts.get(projectId) || new Map();
  }

  /**
   * Return a Map<type, count> for all task types for a given team.
   * @param {string} teamId
   * @returns {Map<string, number>}
   */
  allCountsForTeam(teamId) {
    const counts = this._ensureCounts();
    return counts.teamCounts.get(teamId) || new Map();
  }

  /**
   * Expand feature set with transitive closure of parent/child relations
   * Given a set of feature IDs, return all features connected via parentId relationships
   * Only includes features that exist in the database (excludes User Stories, etc.)
   * @param {Set<string>} baseIds - Starting feature IDs
   * @returns {Set<string>} - Expanded feature IDs including all ancestors and descendants
   */
  expandParentChildClosure(baseIds) {
    const allFeatures = this.getEffectiveFeatures();
    const featureById = new Map(allFeatures.map((f) => [f.id, f]));
    const expanded = new Set(baseIds);
    const toProcess = [...baseIds];

    while (toProcess.length > 0) {
      const id = toProcess.pop();
      const feature = featureById.get(id);
      if (!feature) continue;

      // Add parent epic if exists in database
      if (feature.parentId && !expanded.has(feature.parentId)) {
        // Only add if parent exists in our feature set
        if (featureById.has(feature.parentId)) {
          expanded.add(feature.parentId);
          toProcess.push(feature.parentId);
        }
      }

      // Add children (features that have this as parent)
      // Only include children that exist in the database
      const children = this._childrenByParent.get(id) || [];
      for (const childId of children) {
        if (!expanded.has(childId) && featureById.has(childId)) {
          expanded.add(childId);
          toProcess.push(childId);
        }
      }
    }

    return expanded;
  }

  /**
   * Expand feature set with all relation-linked tasks
   * Includes successor, predecessor, and related-to links
   * Only includes features that exist in the database (excludes User Stories, etc.)
   * @param {Set<string>} baseIds - Starting feature IDs
   * @returns {Set<string>} - Expanded feature IDs including all linked features
   */
  expandRelationLinks(baseIds) {
    const allFeatures = this.getEffectiveFeatures();
    const featureById = new Map(allFeatures.map((f) => [f.id, f]));
    const expanded = new Set(baseIds);
    const toProcess = [...baseIds];

    while (toProcess.length > 0) {
      const id = toProcess.pop();
      const feature = featureById.get(id);
      if (!feature) continue;

      // Process all relation types: successor, predecessor, related
      // Only include relations that exist in our feature database
      const relations = feature.relations || [];
      for (const rel of relations) {
        if (!rel || !rel.id) continue;
        const relId = String(rel.id);
        // Only add if the related feature exists in our database
        if (!expanded.has(relId) && featureById.has(relId)) {
          expanded.add(relId);
          toProcess.push(relId);
        }
      }
    }

    return expanded;
  }

  /**
   * Expand feature set with tasks allocated to selected teams
   * @param {Array<string>} selectedTeamIds - Team IDs to filter by
   * @returns {Set<string>} - Feature IDs that have allocations to any selected team
   */
  expandTeamAllocated(selectedTeamIds) {
    const allFeatures = this.getEffectiveFeatures();
    const teamIdSet = new Set(selectedTeamIds);
    const expanded = new Set();

    for (const feature of allFeatures) {
      if (!feature.capacity || !Array.isArray(feature.capacity)) continue;

      // Check if feature has any capacity allocated to selected teams
      const hasAllocation = feature.capacity.some((cap) => {
        if (!cap || !cap.team) return false;
        const capacity = Number(cap.capacity) || 0;
        return capacity > 0 && teamIdSet.has(cap.team);
      });

      if (hasAllocation) {
        expanded.add(feature.id);
      }
    }

    return expanded;
  }

  /**
   * Compute expanded feature set based on expansion options
   * Each expansion type works from the original selectedIds to avoid compounding
   * @param {Set<string>} selectedIds - Base selected feature IDs
   * @param {Object} expansionOptions - Expansion configuration
   * @param {boolean} expansionOptions.expandParentChild - Include parent/child transitive closure
   * @param {boolean} expansionOptions.expandRelations - Include relation-linked tasks
   * @param {boolean} expansionOptions.expandTeamAllocated - Include team-allocated tasks
   * @param {Array<string>} expansionOptions.selectedTeamIds - Team IDs for team allocation expansion
   * @returns {Object} - { expandedIds: Set, counts: { parentChild: number, relations: number, teamAllocated: number } }
   */
  computeExpandedFeatureSet(selectedIds, expansionOptions = {}) {
    // Start with the base selected set
    const expandedIds = new Set(selectedIds);
    const counts = {
      parentChild: 0,
      relations: 0,
      teamAllocated: 0,
    };

    // Apply parent/child expansion FROM ORIGINAL SELECTED SET
    if (expansionOptions.expandParentChild) {
      const parentChildExpanded = this.expandParentChildClosure(selectedIds);
      const beforeCount = expandedIds.size;
      for (const id of parentChildExpanded) {
        expandedIds.add(id);
      }
      counts.parentChild = expandedIds.size - beforeCount;
    }

    // Apply relation expansion FROM ORIGINAL SELECTED SET (not from parent/child expanded set)
    if (expansionOptions.expandRelations) {
      const relationsExpanded = this.expandRelationLinks(selectedIds);
      const beforeCount = expandedIds.size;
      for (const id of relationsExpanded) {
        expandedIds.add(id);
      }
      counts.relations = expandedIds.size - beforeCount;
    }

    // Apply team allocation expansion (independent of selected set)
    if (
      expansionOptions.expandTeamAllocated &&
      expansionOptions.selectedTeamIds &&
      expansionOptions.selectedTeamIds.length > 0
    ) {
      const teamAllocated = this.expandTeamAllocated(expansionOptions.selectedTeamIds);
      const beforeCount = expandedIds.size;
      for (const id of teamAllocated) {
        expandedIds.add(id);
      }
      counts.teamAllocated = expandedIds.size - beforeCount;
    }

    return { expandedIds, counts };
  }
}
