import { getActiveScenarioId, getScenarioItems } from './scenarioMutations.js';

export function computeDirtyFields(base, override) {
  const fields = [];
  const normDate = (value) => value;
  const normTags = (value) =>
    value.split(';').map((tag) => tag.trim().toLowerCase()).filter(Boolean);

  if ('start' in override && normDate(override.start) !== normDate(base.start)) fields.push('start');
  if ('end' in override && normDate(override.end) !== normDate(base.end)) fields.push('end');
  if ('capacity' in override && JSON.stringify(override.capacity) !== JSON.stringify(base.capacity)) {
    fields.push('capacity');
  }
  if ('state' in override && override.state !== base.state) fields.push('state');
  if (override.iterationPath !== undefined && override.iterationPath !== base.iterationPath) {
    fields.push('iterationPath');
  }
  if (
    'tags' in override &&
    JSON.stringify(normTags(override.tags)) !== JSON.stringify(normTags(base.tags))
  ) {
    fields.push('tags');
  }
  return fields;
}

export function applyFeatureOverride(baseFeature, override, options = {}) {
  if (!override) return { ...baseFeature };
  if (options.includeDirtyMetadata === false) return { ...baseFeature, ...override };

  const changedFields = computeDirtyFields(baseFeature, override);
  return {
    ...baseFeature,
    ...override,
    scenarioOverride: true,
    changedFields,
    dirty: changedFields.length > 0,
  };
}

export function deriveEffectiveFeatures(state, options = {}) {
  const baselineFeatures = state.baseline.features;
  const activeId = getActiveScenarioId(state);
  const scenario = getScenarioItems(state).find((item) => item.id === activeId);
  const overrides = scenario.overrides;

  return baselineFeatures.map((feature) => {
    const key = String(feature.id);
    const override = overrides[key];
    return applyFeatureOverride(feature, override, options);
  });
}

export function buildFeatureMap(features) {
  const map = new Map();
  for (const feature of features) {
    map.set(String(feature.id), feature);
  }
  return map;
}

export function buildChildrenByParentMap(features) {
  const map = new Map();
  for (const feature of features) {
    const parentId = feature.parentId;
    if (!parentId) continue;
    const key = String(parentId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(String(feature.id));
  }
  return map;
}
