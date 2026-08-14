import { CapacityEvents, FeatureEvents, ScenarioEvents } from '../../core/EventRegistry.js';

function isMutableScenario(scenario) {
  return Boolean(scenario) && scenario.readonly !== true;
}

function getScenarioItems(state) {
  return Array.isArray(state?.scenarios?.items) ? state.scenarios.items : [];
}

function getActiveScenarioId(state) {
  return state?.scenarios?.activeId ?? 'baseline';
}

function findActiveScenario(state) {
  const activeId = getActiveScenarioId(state);
  if (!activeId) return null;
  return getScenarioItems(state).find((scenario) => scenario.id === activeId) || null;
}

function getBaselineFeatureMap(state) {
  const map = new Map();
  for (const feature of state?.baseline?.features || []) {
    if (!feature?.id) continue;
    map.set(String(feature.id), feature);
  }
  return map;
}

function getChildrenByParent(state) {
  const childrenByParent = new Map();
  for (const feature of state?.baseline?.features || []) {
    const parentId = feature?.parentId;
    if (!parentId) continue;
    const parentKey = String(parentId);
    if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
    childrenByParent.get(parentKey).push(String(feature.id));
  }
  return childrenByParent;
}

function shiftIsoByMs(isoDate, deltaMs) {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return isoDate;
  return new Date(parsed + deltaMs).toISOString().slice(0, 10);
}

function withActiveScenario(state, updater) {
  const activeId = getActiveScenarioId(state);
  if (!activeId) return null;

  let changed = false;
  const nextItems = getScenarioItems(state).map((scenario) => {
    if (scenario.id !== activeId) return scenario;
    if (!isMutableScenario(scenario)) return scenario;
    const nextScenario = updater(scenario);
    if (!nextScenario || nextScenario === scenario) return scenario;
    changed = true;
    return nextScenario;
  });

  if (!changed) return null;
  return {
    items: nextItems,
    activeId,
  };
}

function withFeatureOverride(scenario, featureId, updater) {
  const key = String(featureId);
  const overrides = { ...(scenario.overrides || {}) };
  const current = overrides[key] || {};
  const next = updater(current);

  if (!next || Object.keys(next).length === 0) {
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
  if (!activeId || activeId === 'baseline') return Array.isArray(state?.scenarios?.changedIds) ? state.scenarios.changedIds : [];
  return Array.from(new Set([...(Array.isArray(state?.scenarios?.changedIds) ? state.scenarios.changedIds : []), String(activeId)]));
}

export function createLegacyFeatureCommands(state) {
  return {
    updateFeatureDates(updates) {
      return state.updateFeatureDates(updates);
    },

    updateFeatureField(id, field, value) {
      return state.updateFeatureField(id, field, value);
    },

    setScenarioOverride(featureId, start, end) {
      return state.setScenarioOverride(featureId, start, end);
    },

    revertFeature(id) {
      return state.revertFeature(id);
    },
  };
}

export function createFeatureCommands(store, bus, recomputeCapacity = null) {
  function recomputeAndEmitCapacity(changedFeatureIds = null) {
    if (typeof recomputeCapacity === 'function') {
      recomputeCapacity(changedFeatureIds);
    }
  }

  function emitFeatureMutation(eventPayload) {
    bus?.emit?.(FeatureEvents.UPDATED, eventPayload || {});
    bus?.emit?.(ScenarioEvents.UPDATED);
  }

  return {
    updateFeatureDates(updates) {
      const safeUpdates = Array.isArray(updates) ? updates : [];
      if (!safeUpdates.length) return [];

      const snapshot = store.getState();
      const baselineById = getBaselineFeatureMap(snapshot);
      const childrenByParent = getChildrenByParent(snapshot);
      const changedIds = new Set();

      const activeScenario = findActiveScenario(snapshot);
      const mergedOverrides = {
        ...(activeScenario?.overrides || {}),
      };

      for (const entry of safeUpdates) {
        if (!entry?.id) continue;
        const id = String(entry.id);
        const base = baselineById.get(id);
        if (!base) continue;

        const existing = mergedOverrides[id] || {};
        const existingStart = existing.start ?? base.start ?? null;
        const existingEnd = existing.end ?? base.end ?? null;
        mergedOverrides[id] = {
          ...existing,
          start: entry.start !== undefined ? entry.start : existingStart,
          end: entry.end !== undefined ? entry.end : existingEnd,
        };
      }

      const mutation = withActiveScenario(snapshot, (scenario) => {
        let nextScenario = scenario;
        for (const entry of safeUpdates) {
          if (!entry?.id) continue;
          const id = String(entry.id);
          const base = baselineById.get(id);
          if (!base) continue;

          const existingOverride = nextScenario.overrides?.[id] || {};
          const currentStart = existingOverride.start ?? base.start ?? null;
          const currentEnd = existingOverride.end ?? base.end ?? null;
          const requestedStart = entry.start !== undefined ? entry.start : currentStart;
          let requestedEnd = entry.end !== undefined ? entry.end : currentEnd;

          const childIds = childrenByParent.get(id) || [];
          if (childIds.length > 0) {
            let maxChildEnd = null;
            for (const childId of childIds) {
              const childBase = baselineById.get(String(childId));
              if (!childBase) continue;
              const childOverride = mergedOverrides[String(childId)] || {};
              const effectiveChildEnd = childOverride.end ?? childBase.end ?? null;
              if (!effectiveChildEnd) continue;
              if (maxChildEnd === null || effectiveChildEnd > maxChildEnd) {
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
            ...(mergedOverrides[id] || {}),
            start: requestedStart,
            end: requestedEnd,
          };

          if (childIds.length > 0) {
            const priorStart = currentStart;
            const newStart = requestedStart;
            const deltaMs = Date.parse(newStart) - Date.parse(priorStart);
            if (!Number.isNaN(deltaMs) && deltaMs !== 0) {
              for (const childId of childIds) {
                const childKey = String(childId);
                const childBase = baselineById.get(childKey);
                if (!childBase) continue;
                const childCurrent = nextScenario.overrides?.[childKey] || {};
                const hasExplicitOverride = Boolean(nextScenario.overrides?.[childKey]);
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
                  ...(mergedOverrides[childKey] || {}),
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
              const parentCurrent = mergedOverrides[parentKey] || {};
              const parentStart = parentCurrent.start ?? parentBase.start ?? null;
              const parentEnd = parentCurrent.end ?? parentBase.end ?? null;
              const nextParentStart =
                requestedStart && parentStart && requestedStart < parentStart ?
                  requestedStart
                : parentStart;
              const nextParentEnd =
                requestedEnd && parentEnd && requestedEnd > parentEnd ? requestedEnd : parentEnd;

              if (nextParentStart !== parentStart || nextParentEnd !== parentEnd) {
                nextScenario = withFeatureOverride(nextScenario, parentKey, (current) => ({
                  ...current,
                  start: nextParentStart,
                  end: nextParentEnd,
                }));
                mergedOverrides[parentKey] = {
                  ...(mergedOverrides[parentKey] || {}),
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
        const ids = safeUpdates.map((entry) => String(entry?.id || '')).filter(Boolean);
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
          start: start !== undefined ? start : (current.start ?? null),
          end: end !== undefined ? end : (current.end ?? null),
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
        const overrides = { ...(scenario.overrides || {}) };
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
      const id = feature?.id != null ? String(feature.id) : null;
      store.setState(
        (state) => ({
          ...state,
          featureDisplay: { ...state.featureDisplay, selectedId: id },
        }),
        false,
        'feature.setSelectedFeature'
      );
      bus?.emit?.(FeatureEvents.SELECTED);
    },
  };
}
