import { DEFAULT_STATE_COLOR_MAP, PALETTE } from '../../services/ColorService.js';
import { normalizeTaskFilters } from '../shared/taskFilters.js';
import {
  deriveConfiguredStateSequence,
  deriveOrderedFeatureStateNames,
} from '../shared/stateDerivations.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */

function toStateSet(input) {
  if (input instanceof Set) return new Set(Array.from(input));
  return new Set(input);
}

function deriveStateColor(stateName) {
  if (!stateName) return PALETTE[0];

  const lowerStateName = String(stateName).toLowerCase();
  const direct = DEFAULT_STATE_COLOR_MAP[String(stateName)];
  const lowerKey = Object.keys(DEFAULT_STATE_COLOR_MAP).find((key) => key.toLowerCase() === lowerStateName);
  const mapped = direct !== undefined ? direct : DEFAULT_STATE_COLOR_MAP[lowerKey];
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
  for (const stateName of states) {
    const background = deriveStateColor(stateName);
    map[stateName] = {
      background,
      text: pickLegacyTextColor(background),
    };
  }
  return map;
}

function hasAnyTrueOption(filterOptions) {
  const values = Object.values(filterOptions);
  if (!values.length) return true;
  return values.some((value) => value === true);
}

function createFallbackTaskFilterFn(store) {
  return (feature) => {
    const filters = normalizeTaskFilters(store.getState().selection.taskFilters);
    const schedule = filters.schedule;
    const allocation = filters.allocation;
    const hierarchy = filters.hierarchy;
    const relations = filters.relations;

    const hasDates = !!(feature.start && feature.end);
    const hasCapacity = feature.capacity.length > 0;
    const hasParent = !!feature.parentId;
    const hasLinks = feature.relations.length > 0;

    if (!hasAnyTrueOption(schedule)) return false;
    if (schedule.planned === true && !hasDates && schedule.unplanned !== true) return false;
    if (schedule.unplanned === true && hasDates && schedule.planned !== true) return false;

    if (!hasAnyTrueOption(allocation)) return false;
    if (allocation.allocated === true && !hasCapacity && allocation.unallocated !== true) {
      return false;
    }
    if (allocation.unallocated === true && hasCapacity && allocation.allocated !== true) {
      return false;
    }

    if (!hasAnyTrueOption(hierarchy)) return false;
    if (hierarchy.hasParent === true && !hasParent && hierarchy.noParent !== true) return false;
    if (hierarchy.noParent === true && hasParent && hierarchy.hasParent !== true) return false;

    if (!hasAnyTrueOption(relations)) return false;
    if (relations.hasLinks === true && !hasLinks && relations.noLinks !== true) return false;
    if (relations.noLinks === true && hasLinks && relations.hasLinks !== true) return false;

    return true;
  };
}

function compareStrings(a, b) {
  return String(a).localeCompare(String(b));
}

function deriveStateCategoryMap(projects) {
  const categories = {};
  for (const project of projects) {
    const projectCategories = project.state_categories;
    for (const [stateName, category] of Object.entries(projectCategories)) {
      categories[String(stateName)] = String(category);
    }
  }
  return categories;
}

/**
 * @param {StoreApi} store
 * @returns {object}
 */
export function createFilterSelectors(store) {
  const fallbackTaskFilter = createFallbackTaskFilterFn(store);

  function getSelectionTaskFilters() {
    return normalizeTaskFilters(store.getState().selection.taskFilters);
  }

  function getStateCategories() {
    return deriveStateCategoryMap(store.getState().baseline.projects);
  }

  function getConfiguredSequence() {
    return deriveConfiguredStateSequence(store.getState().baseline.projects);
  }

  const selectors = {
    getSelectedFeatureStateSet() {
      return toStateSet(store.getState().selection.featureStateNames);
    },

    getSelectedFeatureStateNames() {
      return Array.from(toStateSet(store.getState().selection.featureStateNames));
    },

    getAvailableFeatureStates() {
      const state = store.getState();
      return deriveOrderedFeatureStateNames(state.baseline.projects, state.baseline.features);
    },

    getFeatureStateColors() {
      return deriveStateColorMap(selectors.getAvailableFeatureStates());
    },

    featurePassesFilters(feature) {
      return fallbackTaskFilter(feature);
    },

    getFeatureStateCategory(stateName) {
      const key = String(stateName);
      const category = getStateCategories()[key];
      return category === undefined ? '' : category;
    },

    compareFeatureStates(a, b) {
      const configured = getConfiguredSequence();
      if (configured.length > 0) {
        const aIndex = configured.indexOf(String(a));
        const bIndex = configured.indexOf(String(b));
        if (aIndex !== -1) {
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        }
        if (bIndex !== -1) {
          if (aIndex === -1) return 1;
          return aIndex - bIndex;
        }
      }
      return compareStrings(a, b);
    },

    getTaskFilters() {
      return getSelectionTaskFilters();
    },
  };

  return selectors;
}
