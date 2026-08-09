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
  };
}

export function createFilterSelectors(store) {
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
  };
}
