/**
 * AnnotationStorage.js
 * localStorage helpers for annotation persistence
 */

const STORAGE_KEY = 'plannerTool_annotations';

/**
 * Save annotations to localStorage
 * @param {Array} annotations - Array of annotation objects
 */
export function saveAnnotations(annotations) {
  try {
    const data = JSON.stringify(annotations);
    localStorage.setItem(STORAGE_KEY, data);
  } catch (e) {
    console.warn('[AnnotationStorage] Failed to save annotations:', e);
  }
}

/**
 * Load annotations from localStorage
 * @returns {Array} Array of annotation objects, or empty array if none
 */
export function loadAnnotations() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('[AnnotationStorage] Failed to load annotations:', e);
  }
  return [];
}

/**
 * Clear all saved annotations
 */
export function clearAnnotations() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[AnnotationStorage] Failed to clear annotations:', e);
  }
}

/**
 * Generate a unique ID for annotations
 * @returns {string} Unique identifier
 */
export function generateId() {
  return `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
