/**
 * Annotations Plugin - Module exports
 */

// Colors and constants
export { ANNOTATION_COLORS, getRandomColor } from './AnnotationColors.js';

// Storage
export { saveAnnotations, loadAnnotations, clearAnnotations, generateId } from './AnnotationStorage.js';

// State and tools
export { 
  TOOLS, 
  TOOL_DEFINITIONS,
  AnnotationState,
  getAnnotationState,
  createNoteAnnotation,
  createRectAnnotation,
  createLineAnnotation
} from './AnnotationState.js';

// Components
export { AnnotationOverlay } from './AnnotationOverlay.js';
