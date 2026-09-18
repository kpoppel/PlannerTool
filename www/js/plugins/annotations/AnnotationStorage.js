/**
 * AnnotationStorage.js
 * Small ID helper for annotation objects. Persistence lives in the scenario's
 * `pluginData` bag (see AnnotationState.js) rather than here.
 */

/**
 * Generate a unique ID for annotations
 * @returns {string} Unique identifier
 */
export function generateId() {
  return `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
