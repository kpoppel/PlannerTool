/**
 * AnnotationColors.js
 * Color palette and constants for annotations
 */

// ============================================================================
// Color Palette - Pastel colors with good contrast for black text
// ============================================================================

export const ANNOTATION_COLORS = {
  palette: [
    { name: 'Coral', fill: '#FFB5A7', stroke: '#E07A5F' },
    { name: 'Peach', fill: '#FFD6A5', stroke: '#E9A84A' },
    { name: 'Lemon', fill: '#FDFFB6', stroke: '#D4C600' },
    { name: 'Mint', fill: '#CAFFBF', stroke: '#4CAF50' },
    { name: 'Sky', fill: '#9BF6FF', stroke: '#00BCD4' },
    { name: 'Lavender', fill: '#BDB2FF', stroke: '#7C4DFF' },
    { name: 'Pink', fill: '#FFC6FF', stroke: '#E040FB' },
    { name: 'Cloud', fill: '#F0F0F0', stroke: '#9E9E9E' }
  ],
  defaultFill: '#FDFFB6',
  defaultStroke: '#D4C600',
  textColor: '#1A1A1A',
  lineColor: '#333333'
};

/**
 * Get a random color from the palette
 * @returns {Object} { fill, stroke, name }
 */
export function getRandomColor() {
  const idx = Math.floor(Math.random() * ANNOTATION_COLORS.palette.length);
  return ANNOTATION_COLORS.palette[idx];
}
