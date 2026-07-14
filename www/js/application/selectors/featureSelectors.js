function toJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return 'null';
  }
}

/**
 * Select changed feature fields between baseline and override snapshots.
 *
 * @param {object} featureBase
 * @param {object|null|undefined} override
 * @returns {string[]}
 */
export function selectChangedFeatureFields(featureBase, override) {
  if (!override || typeof override !== 'object') return [];

  const changedFields = [];
  if (override.start && override.start !== featureBase?.start) changedFields.push('start');
  if (override.end && override.end !== featureBase?.end) changedFields.push('end');
  if (override.capacity && toJson(override.capacity) !== toJson(featureBase?.capacity)) {
    changedFields.push('capacity');
  }
  return changedFields;
}

/**
 * Select feature dirty metadata from baseline/override snapshots.
 *
 * @param {object} featureBase
 * @param {object|null|undefined} override
 * @returns {{ changedFields: string[], dirty: boolean }}
 */
export function selectFeatureDirtyMetadata(featureBase, override) {
  const changedFields = selectChangedFeatureFields(featureBase, override);
  return {
    changedFields,
    dirty: changedFields.length > 0,
  };
}

/**
 * Select non-empty feature ids from bulk update payloads.
 *
 * @param {Array<{id?: string}>|unknown} updates
 * @returns {string[]}
 */
export function selectFeatureIdsFromUpdates(updates) {
  if (!Array.isArray(updates)) return [];
  return updates.map((update) => update?.id).filter(Boolean);
}