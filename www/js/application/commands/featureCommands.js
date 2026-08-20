import { CapacityEvents, FeatureEvents, ScenarioEvents } from '../../core/EventRegistry.js';
import {
  buildChildrenByParentMap,
  buildFeatureMap,
} from '../shared/featureProjection.js';
import {
  getActiveScenario,
  getActiveScenarioId,
  getScenarioItems,
  withActiveScenario,
} from '../shared/scenarioMutations.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */
/** @typedef {import('../types.js').EventBusLike} EventBusLike */

function getBaselineFeatureMap(state) {
  return buildFeatureMap(state.baseline.features);
}

function shiftIsoByMs(isoDate, deltaMs) {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return isoDate;
  return new Date(parsed + deltaMs).toISOString().slice(0, 10);
}

function withFeatureOverride(scenario, featureId, updater) {
  const key = String(featureId);
  const overrides = { ...scenario.overrides };
  const current = overrides[key] === undefined ? {} : overrides[key];
  const next = updater(current);

  if (Object.keys(next).length === 0) {
    if (!overrides[key]) return scenario;
    delete overrides[key];
  } else {
    overrides[key] = next;
  }

  return {
    ...scenario,
    overrides,
  };
}

function addActiveScenarioToChangedIds(state) {
  const activeId = getActiveScenarioId(state);
  if (activeId === 'baseline') return state.scenarios.changedIds;
  return Array.from(new Set([...state.scenarios.changedIds, String(activeId)]));
}

/**
 * @param {StoreApi} store
 * @param {EventBusLike} bus
 * @param {((changedFeatureIds?: string[]|null) => void)|null} [recomputeCapacity]
 * @returns {object}
 */
export function createFeatureCommands(store, bus, recomputeCapacity = null) {
  function requireRecomputeCapacity() {
    if (typeof recomputeCapacity !== 'function') {
      throw new TypeError('featureCommands requires recomputeCapacity');
    }
  }

  /**
   * @param {string[]|null} [changedFeatureIds]
   */
  function recomputeAndEmitCapacity(changedFeatureIds = null) {
    requireRecomputeCapacity();
    if (typeof recomputeCapacity !== 'function') {
      throw new TypeError('featureCommands requires recomputeCapacity');
    }
    recomputeCapacity(changedFeatureIds);
  }

  function emitFeatureMutation(eventPayload) {
    bus.emit(FeatureEvents.UPDATED, eventPayload);
    bus.emit(ScenarioEvents.UPDATED);
  }

  return {
    updateFeatureDates(updates) {
      const safeUpdates = updates;
      if (!safeUpdates.length) return [];

      const snapshot = store.getState();
      const baselineById = getBaselineFeatureMap(snapshot);
      const childrenByParent = buildChildrenByParentMap(snapshot.baseline.features);
      const changedIds = new Set();

      const activeScenario = getActiveScenario(snapshot);
      const mergedOverrides = {
        ...activeScenario.overrides,
      };

      for (const entry of safeUpdates) {
        if (!entry.id) continue;
        const id = String(entry.id);
        const base = baselineById.get(id);
        if (!base) continue;

        const existing = mergedOverrides[id] === undefined ? {} : mergedOverrides[id];
        const existingStart = existing.start !== undefined ? existing.start : (base.start !== undefined ? base.start : null);
        const existingEnd = existing.end !== undefined ? existing.end : (base.end !== undefined ? base.end : null);
        mergedOverrides[id] = {
          ...existing,
          start: entry.start !== undefined ? entry.start : existingStart,
          end: entry.end !== undefined ? entry.end : existingEnd,
        };
      }

      const mutation = withActiveScenario(snapshot, (scenario) => {
        let nextScenario = scenario;
        for (const entry of safeUpdates) {
          if (!entry.id) continue;
          const id = String(entry.id);
          const base = baselineById.get(id);
          if (!base) continue;

          const existingOverride = nextScenario.overrides[id] === undefined ? {} : nextScenario.overrides[id];
          const currentStart = existingOverride.start !== undefined ? existingOverride.start : (base.start !== undefined ? base.start : null);
          const currentEnd = existingOverride.end !== undefined ? existingOverride.end : (base.end !== undefined ? base.end : null);
          const requestedStart = entry.start !== undefined ? entry.start : currentStart;
          let requestedEnd = entry.end !== undefined ? entry.end : currentEnd;

          const childIds = childrenByParent.get(id);
          if (childIds !== undefined && childIds.length > 0) {
            let maxChildEnd = null;
            for (const childId of childIds) {
              const childBase = baselineById.get(String(childId));
              if (!childBase) continue;
              const childOverride = mergedOverrides[String(childId)] === undefined ? {} : mergedOverrides[String(childId)];
              const effectiveChildEnd = childOverride.end !== undefined ? childOverride.end : (childBase.end !== undefined ? childBase.end : null);
              if (!effectiveChildEnd) continue;
              if (maxChildEnd === null) {
                maxChildEnd = effectiveChildEnd;
              } else if (effectiveChildEnd > maxChildEnd) {
                maxChildEnd = effectiveChildEnd;
              }
            }
            if (maxChildEnd && requestedEnd && requestedEnd < maxChildEnd) {
              requestedEnd = maxChildEnd;
            }
          }

          if (requestedStart === currentStart && requestedEnd === currentEnd) {
            continue;
          }

          nextScenario = withFeatureOverride(nextScenario, id, (current) => ({
            ...current,
            start: requestedStart,
            end: requestedEnd,
          }));
          changedIds.add(id);
          mergedOverrides[id] = {
            ...(mergedOverrides[id] === undefined ? {} : mergedOverrides[id]),
            start: requestedStart,
            end: requestedEnd,
          };

          if (childIds !== undefined && childIds.length > 0) {
            const priorStart = currentStart;
            const newStart = requestedStart;
            const deltaMs = Date.parse(newStart) - Date.parse(priorStart);
            if (!Number.isNaN(deltaMs) && deltaMs !== 0) {
              for (const childId of childIds) {
                const childKey = String(childId);
                const childBase = baselineById.get(childKey);
                if (!childBase) continue;
                const childCurrent = nextScenario.overrides[childKey] === undefined ? {} : nextScenario.overrides[childKey];
                const hasExplicitOverride = Object.prototype.hasOwnProperty.call(nextScenario.overrides, childKey);
                if (hasExplicitOverride) {
                  changedIds.add(childKey);
                  continue;
                }
                const shiftedStart = shiftIsoByMs(childBase.start, deltaMs);
                const shiftedEnd = shiftIsoByMs(childBase.end, deltaMs);
                nextScenario = withFeatureOverride(nextScenario, childKey, (current) => ({
                  ...current,
                  start: shiftedStart,
                  end: shiftedEnd,
                }));
                mergedOverrides[childKey] = {
                  ...(mergedOverrides[childKey] === undefined ? {} : mergedOverrides[childKey]),
                  start: shiftedStart,
                  end: shiftedEnd,
                };
                changedIds.add(childKey);
              }
            } else {
              for (const childId of childIds) changedIds.add(String(childId));
            }
          }

          if (base.parentId) {
            const parentKey = String(base.parentId);
            const parentBase = baselineById.get(parentKey);
            if (parentBase) {
              const parentCurrent = mergedOverrides[parentKey] === undefined ? {} : mergedOverrides[parentKey];
              const parentStart = parentCurrent.start !== undefined ? parentCurrent.start : (parentBase.start !== undefined ? parentBase.start : null);
              const parentEnd = parentCurrent.end !== undefined ? parentCurrent.end : (parentBase.end !== undefined ? parentBase.end : null);
              const nextParentStart =
                requestedStart && parentStart && requestedStart < parentStart ?
                  requestedStart
                : parentStart;
              const nextParentEnd =
                requestedEnd && parentEnd && requestedEnd > parentEnd ? requestedEnd : parentEnd;

              if (nextParentStart !== parentStart) {
                nextScenario = withFeatureOverride(nextScenario, parentKey, (current) => ({
                  ...current,
                  start: nextParentStart,
                  end: nextParentEnd,
                }));
                mergedOverrides[parentKey] = {
                  ...(mergedOverrides[parentKey] === undefined ? {} : mergedOverrides[parentKey]),
                  start: nextParentStart,
                  end: nextParentEnd,
                };
                changedIds.add(parentKey);
              } else if (nextParentEnd !== parentEnd) {
                nextScenario = withFeatureOverride(nextScenario, parentKey, (current) => ({
                  ...current,
                  start: nextParentStart,
                  end: nextParentEnd,
                }));
                mergedOverrides[parentKey] = {
                  ...(mergedOverrides[parentKey] === undefined ? {} : mergedOverrides[parentKey]),
                  start: nextParentStart,
                  end: nextParentEnd,
                };
                changedIds.add(parentKey);
              }
            }
          }
        }
        return nextScenario;
      });

      if (!mutation) {
        const ids = safeUpdates.map((entry) => String(entry.id)).filter((id) => id !== '');
        recomputeAndEmitCapacity(ids.length ? ids : null);
        emitFeatureMutation({ ids });
        return safeUpdates;
      }

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: addActiveScenarioToChangedIds(state),
            items: mutation.items,
          },
        }),
        false,
        'feature.updateFeatureDates'
      );

      const ids = Array.from(changedIds);
      recomputeAndEmitCapacity(ids.length ? ids : null);
      emitFeatureMutation({ ids });
      return safeUpdates;
    },

    updateFeatureField(id, field, value) {
      if (!id || !field) return null;

      const snapshot = store.getState();
      const mutation = withActiveScenario(snapshot, (scenario) =>
        withFeatureOverride(scenario, id, (current) => ({
          ...current,
          [field]: value,
        }))
      );

      if (!mutation) {
        recomputeAndEmitCapacity([String(id)]);
        emitFeatureMutation({ id: String(id), field: String(field) });
        return { id: String(id), [field]: value };
      }

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: addActiveScenarioToChangedIds(state),
            items: mutation.items,
          },
        }),
        false,
        'feature.updateFeatureField'
      );

      recomputeAndEmitCapacity([id]);
      emitFeatureMutation({ id: String(id), field: String(field) });
      return { id: String(id), [field]: value };
    },

    setScenarioOverride(featureId, start, end) {
      if (!featureId) return null;

      const snapshot = store.getState();
      const mutation = withActiveScenario(snapshot, (scenario) =>
        withFeatureOverride(scenario, featureId, (current) => ({
          ...current,
          start: start !== undefined ? start : (current.start !== undefined ? current.start : null),
          end: end !== undefined ? end : (current.end !== undefined ? current.end : null),
        }))
      );

      if (!mutation) {
        recomputeAndEmitCapacity([String(featureId)]);
        emitFeatureMutation({ id: String(featureId), fields: ['start', 'end'] });
        return {
          id: String(featureId),
          start: start !== undefined ? start : null,
          end: end !== undefined ? end : null,
        };
      }

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: addActiveScenarioToChangedIds(state),
            items: mutation.items,
          },
        }),
        false,
        'feature.setScenarioOverride'
      );

      recomputeAndEmitCapacity([featureId]);
      emitFeatureMutation({ id: String(featureId), fields: ['start', 'end'] });
      return {
        id: String(featureId),
        start: start !== undefined ? start : null,
        end: end !== undefined ? end : null,
      };
    },

    revertFeature(id) {
      if (!id) return false;

      const snapshot = store.getState();
      const mutation = withActiveScenario(snapshot, (scenario) => {
        const key = String(id);
        const overrides = { ...scenario.overrides };
        if (!Object.prototype.hasOwnProperty.call(overrides, key)) {
          return scenario;
        }
        delete overrides[key];
        return {
          ...scenario,
          overrides,
        };
      });

      if (!mutation) {
        return false;
      }

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: addActiveScenarioToChangedIds(state),
            items: mutation.items,
          },
        }),
        false,
        'feature.revertFeature'
      );

      recomputeAndEmitCapacity([id]);
      emitFeatureMutation({ id: String(id), type: 'revert' });
      return true;
    },

    setSelectedFeature(feature) {
      const id = feature && feature.id != null ? String(feature.id) : null;
      store.setState(
        (state) => ({
          ...state,
          featureDisplay: { ...state.featureDisplay, selectedId: id },
        }),
        false,
        'feature.setSelectedFeature'
      );
      bus.emit(FeatureEvents.SELECTED);
    },
  };
}
