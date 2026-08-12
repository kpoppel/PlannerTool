const DEFAULT_TASK_FILTERS = {
  schedule: { planned: true, unplanned: true },
  allocation: { allocated: true, unallocated: true },
  hierarchy: { hasParent: true, noParent: true },
  relations: { hasLinks: true, noLinks: true },
};

function normalizeTaskFilters(filters = {}) {
  const next = {};
  for (const [dimension, options] of Object.entries(DEFAULT_TASK_FILTERS)) {
    const current = filters?.[dimension];
    next[dimension] = {
      ...options,
      ...(current && typeof current === 'object' ? current : {}),
    };
  }
  return next;
}

function toStateSet(input) {
  if (input instanceof Set) return new Set(Array.from(input));
  if (Array.isArray(input)) return new Set(input);
  if (input == null) return new Set();
  return new Set([input]);
}

function deriveAvailableStatesFromFeatures(features) {
  const out = [];
  const seen = new Set();
  for (const feature of Array.isArray(features) ? features : []) {
    const stateName = feature?.state;
    if (!stateName) continue;
    const key = String(stateName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function hashColor(seed) {
  let hash = 0;
  const text = String(seed || 'state');
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 45%)`;
}

function deriveStateColorMap(states) {
  const map = {};
  for (const stateName of states || []) {
    map[stateName] = {
      background: hashColor(stateName),
      text: '#ffffff',
    };
  }
  return map;
}

function hasAnyTrueOption(filterOptions) {
  if (!filterOptions || typeof filterOptions !== 'object') return true;
  const values = Object.values(filterOptions);
  if (!values.length) return true;
  return values.some((value) => value === true);
}

function createFallbackTaskFilterFn(store) {
  return (feature) => {
    const filters = normalizeTaskFilters(store.getState()?.selection?.taskFilters);
    const schedule = filters.schedule || {};
    const allocation = filters.allocation || {};
    const hierarchy = filters.hierarchy || {};
    const relations = filters.relations || {};

    const hasDates = !!(feature?.start && feature?.end);
    const hasCapacity = Array.isArray(feature?.capacity) && feature.capacity.length > 0;
    const hasParent = !!feature?.parentId;
    const hasLinks = Array.isArray(feature?.relations) && feature.relations.length > 0;

    if (hasAnyTrueOption(schedule)) {
      if (schedule.planned === true && !hasDates && schedule.unplanned !== true) return false;
      if (schedule.unplanned === true && hasDates && schedule.planned !== true) return false;
    }

    if (hasAnyTrueOption(allocation)) {
      if (allocation.allocated === true && !hasCapacity && allocation.unallocated !== true) {
        return false;
      }
      if (allocation.unallocated === true && hasCapacity && allocation.allocated !== true) {
        return false;
      }
    }

    if (hasAnyTrueOption(hierarchy)) {
      if (hierarchy.hasParent === true && !hasParent && hierarchy.noParent !== true) return false;
      if (hierarchy.noParent === true && hasParent && hierarchy.hasParent !== true) return false;
    }

    if (hasAnyTrueOption(relations)) {
      if (relations.hasLinks === true && !hasLinks && relations.noLinks !== true) return false;
      if (relations.noLinks === true && hasLinks && relations.hasLinks !== true) return false;
    }

    return true;
  };
}

function compareStrings(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

export function createLegacyFilterSelectors(state) {
  return {
    getSelectedFeatureStateSet() {
      return toStateSet(state?.selectedFeatureStateFilter);
    },

    getSelectedFeatureStateNames() {
      return Array.from(toStateSet(state?.selectedFeatureStateFilter));
    },

    getAvailableFeatureStates() {
      return Array.isArray(state?.availableFeatureStates) ? state.availableFeatureStates : [];
    },

    getFeatureStateColors() {
      if (typeof state?.getFeatureStateColors === 'function') {
        return state.getFeatureStateColors();
      }
      if (state?._colorService?.getFeatureStateColors) {
        return state._colorService.getFeatureStateColors(this.getAvailableFeatureStates());
      }
      return deriveStateColorMap(this.getAvailableFeatureStates());
    },

    featurePassesFilters(feature) {
      if (state?.taskFilterService?.featurePassesFilters) {
        return state.taskFilterService.featurePassesFilters(feature);
      }
      return true;
    },

    getFeatureStateCategory(stateName) {
      if (state?.featureStateService?.getCategoryForState) {
        return state.featureStateService.getCategoryForState(stateName) || '';
      }
      return '';
    },

    compareFeatureStates(a, b) {
      if (typeof state?.compareFeatureStates === 'function') {
        return state.compareFeatureStates(a, b);
      }
      return compareStrings(a, b);
    },

    getTaskFilters() {
      if (state?.taskFilterService?.getFilters) {
        return state.taskFilterService.getFilters();
      }
      return null;
    },
  };
}

export function createFilterSelectors(store, legacyState = null) {
  const fallbackTaskFilter = createFallbackTaskFilterFn(store);

  function getSelectionTaskFilters() {
    return normalizeTaskFilters(store.getState()?.selection?.taskFilters);
  }

  return {
    getSelectedFeatureStateSet() {
      return toStateSet(store.getState()?.selection?.featureStateNames);
    },

    getSelectedFeatureStateNames() {
      return Array.from(toStateSet(store.getState()?.selection?.featureStateNames));
    },

    getAvailableFeatureStates() {
      const state = store.getState();
      const explicit = state?.filter?.availableFeatureStates;
      if (Array.isArray(explicit)) return explicit;
      return deriveAvailableStatesFromFeatures(state?.baseline?.features);
    },

    getFeatureStateColors() {
      if (legacyState?._colorService?.getFeatureStateColors) {
        return legacyState._colorService.getFeatureStateColors(this.getAvailableFeatureStates());
      }
      return deriveStateColorMap(this.getAvailableFeatureStates());
    },

    featurePassesFilters(feature) {
      return fallbackTaskFilter(feature);
    },

    getFeatureStateCategory(stateName) {
      if (legacyState?.featureStateService?.getCategoryForState) {
        return legacyState.featureStateService.getCategoryForState(stateName) || '';
      }
      return '';
    },

    compareFeatureStates(a, b) {
      if (typeof legacyState?.compareFeatureStates === 'function') {
        return legacyState.compareFeatureStates(a, b);
      }
      return compareStrings(a, b);
    },

    getTaskFilters() {
      return getSelectionTaskFilters();
    },
  };
}
