function getScenarioItems(state) {
  return Array.isArray(state?.scenarios?.items) ? state.scenarios.items : [];
}

function getActiveScenario(state) {
  const activeId = state?.scenarios?.activeId ?? 'baseline';
  if (!activeId || activeId === 'baseline') return null;
  return getScenarioItems(state).find((scenario) => scenario.id === activeId) || null;
}

function applyOverride(baseFeature, override) {
  if (!override) return { ...baseFeature };
  return {
    ...baseFeature,
    ...override,
  };
}

function deriveEffectiveFeatures(state) {
  const baselineFeatures = Array.isArray(state?.baseline?.features) ? state.baseline.features : [];
  const scenario = getActiveScenario(state);
  const overrides = scenario?.overrides || {};

  return baselineFeatures.map((feature) => {
    const key = String(feature?.id ?? '');
    const override = overrides[key];
    return applyOverride(feature, override);
  });
}

export function createLegacyFeatureSelectors(state) {
  return {
    getEffectiveFeatures() {
      if (typeof state.getEffectiveFeatures === 'function') {
        return state.getEffectiveFeatures();
      }
      return [];
    },

    getEffectiveFeatureById(id) {
      if (typeof state.getEffectiveFeatureById === 'function') {
        return state.getEffectiveFeatureById(id);
      }
      const features = this.getEffectiveFeatures();
      return features.find((feature) => String(feature?.id) === String(id)) || null;
    },
  };
}

export function createFeatureSelectors(store) {
  return {
    getEffectiveFeatures() {
      return deriveEffectiveFeatures(store.getState());
    },

    getEffectiveFeatureById(id) {
      const key = String(id);
      const features = deriveEffectiveFeatures(store.getState());
      return features.find((feature) => String(feature?.id) === key) || null;
    },
  };
}
