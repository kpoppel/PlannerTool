import { DEFAULT_STATE_COLOR_MAP, PALETTE } from '../../services/ColorService.js';

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

function legacyStateColor(stateName) {
  if (!stateName) return PALETTE[0];

  const lowerStateName = String(stateName).toLowerCase();
  const mapped = DEFAULT_STATE_COLOR_MAP[String(stateName)] || DEFAULT_STATE_COLOR_MAP[Object.keys(DEFAULT_STATE_COLOR_MAP).find((key) => key.toLowerCase() === lowerStateName)];
  if (mapped) return mapped;

  let hash = 0;
  for (let i = 0; i < lowerStateName.length; i += 1) {
    hash = (hash << 5) - hash + lowerStateName.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % PALETTE.length;
  return PALETTE[idx];
}

function pickLegacyTextColor(hex) {
  if (!hex) return '#000';

  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);

  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#000' : '#fff';
}

function deriveStateColorMap(states) {
  const map = {};
  for (const stateName of states || []) {
    const background = legacyStateColor(stateName);
    map[stateName] = {
      background,
      text: pickLegacyTextColor(background),
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

function deriveStateCategoryMap(projects) {
  const categories = {};
  for (const project of Array.isArray(projects) ? projects : []) {
    const projectCategories = project?.state_categories || project?.stateCategories || {};
    for (const [stateName, category] of Object.entries(projectCategories)) {
      if (stateName == null || category == null) continue;
      categories[String(stateName)] = String(category);
    }
  }
  return categories;
}

function deriveConfiguredStateSequence(projects) {
  const sequence = [];
  const seen = new Set();

  for (const project of Array.isArray(projects) ? projects : []) {
    const raw = project?.state_display_sequence || project?.stateDisplaySequence || [];
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (!item || typeof item !== 'object' || !Array.isArray(item.types)) continue;
      for (const stateName of item.types) {
        const value = String(stateName || '').trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        sequence.push(value);
      }
    }
  }

  return sequence;
}

function applyConfiguredStateSequence(states, projects) {
  const ordered = [];
  const seen = new Set();
  const configured = deriveConfiguredStateSequence(projects);

  for (const configuredState of configured) {
    const matchingState = states.find((stateName) => String(stateName) === String(configuredState));
    if (!matchingState || seen.has(matchingState)) continue;
    ordered.push(matchingState);
    seen.add(matchingState);
  }

  for (const stateName of states) {
    if (seen.has(stateName)) continue;
    ordered.push(stateName);
    seen.add(stateName);
  }

  return ordered;
}

export function createFilterSelectors(store, legacyState = null) {
  const fallbackTaskFilter = createFallbackTaskFilterFn(store);

  function getSelectionTaskFilters() {
    return normalizeTaskFilters(store.getState()?.selection?.taskFilters);
  }

  function getStateCategories() {
    return deriveStateCategoryMap(store.getState()?.baseline?.projects);
  }

  function getConfiguredSequence() {
    return deriveConfiguredStateSequence(store.getState()?.baseline?.projects);
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
      const baselineStates = deriveAvailableStatesFromFeatures(state?.baseline?.features);
      const configuredSequence = deriveConfiguredStateSequence(state?.baseline?.projects);

      if (configuredSequence.length > 0) {
        return applyConfiguredStateSequence(baselineStates, state?.baseline?.projects);
      }

      const explicit = state?.filter?.availableFeatureStates;
      return Array.isArray(explicit) && explicit.length > 0 ? explicit : baselineStates;
    },

    getFeatureStateColors() {
      return deriveStateColorMap(this.getAvailableFeatureStates());
    },

    featurePassesFilters(feature) {
      return fallbackTaskFilter(feature);
    },

    getFeatureStateCategory(stateName) {
      const key = String(stateName ?? '');
      return getStateCategories()[key] || '';
    },

    compareFeatureStates(a, b) {
      const configured = getConfiguredSequence();
      if (configured.length > 0) {
        const aIndex = configured.indexOf(String(a ?? ''));
        const bIndex = configured.indexOf(String(b ?? ''));
        if (aIndex !== -1 || bIndex !== -1) {
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        }
      }
      return compareStrings(a, b);
    },

    getTaskFilters() {
      return getSelectionTaskFilters();
    },
  };
}
