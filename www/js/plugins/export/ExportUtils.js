/**
 * ExportUtils.js
 * Helper utilities for timeline export and annotations
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

// ============================================================================
// localStorage helpers for annotation persistence
// ============================================================================

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
    console.warn('[ExportUtils] Failed to save annotations:', e);
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
    console.warn('[ExportUtils] Failed to load annotations:', e);
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
    console.warn('[ExportUtils] Failed to clear annotations:', e);
  }
}

// ============================================================================
// ID generation
// ============================================================================

/**
 * Generate a unique ID for annotations
 * @returns {string} Unique identifier
 */
export function generateId() {
  return `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// Viewport and positioning helpers
// ============================================================================

/**
 * Get the visible viewport bounds of the timeline section
 * @returns {Object} { x, y, width, height, scrollLeft, scrollTop, fullHeight }
 */
export function getViewportBounds() {
  const timelineSection = document.getElementById('timelineSection');
  const featureBoard = document.querySelector('feature-board');
  const mainGraph = document.querySelector('maingraph-lit');
  
  if (!timelineSection) {
    return { x: 0, y: 0, width: 800, height: 600, scrollLeft: 0, scrollTop: 0, fullHeight: 600 };
  }
  
  const rect = timelineSection.getBoundingClientRect();
  const mainGraphRect = mainGraph ? mainGraph.getBoundingClientRect() : { height: 120 };
  
  // Full height includes all scrollable content
  const fullHeight = featureBoard ? featureBoard.scrollHeight : rect.height;
  
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    scrollLeft: timelineSection.scrollLeft,
    scrollTop: timelineSection.scrollTop,
    fullHeight: fullHeight,
    mainGraphHeight: mainGraphRect.height
  };
}

/**
 * Convert screen coordinates to export coordinates
 * (accounts for scroll position)
 * @param {number} screenX - Screen X coordinate
 * @param {number} screenY - Screen Y coordinate
 * @param {Object} viewport - Viewport bounds from getViewportBounds()
 * @returns {Object} { x, y } in export coordinates
 */
export function screenToExportCoords(screenX, screenY, viewport) {
  return {
    x: screenX - viewport.x,
    y: screenY - viewport.y
  };
}

// ============================================================================
// SVG helpers
// ============================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an SVG element with attributes
 * @param {string} tag - SVG element tag name
 * @param {Object} attrs - Attributes to set
 * @returns {SVGElement}
 */
export function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

/**
 * Create an SVG text element with proper styling
 * @param {string} text - Text content
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {Object} options - { fontSize, fontFamily, fill, anchor }
 * @returns {SVGElement}
 */
export function createSvgText(text, x, y, options = {}) {
  const {
    fontSize = 12,
    fontFamily = 'system-ui, -apple-system, sans-serif',
    fill = ANNOTATION_COLORS.textColor,
    anchor = 'start'
  } = options;
  
  const el = createSvgElement('text', {
    x,
    y,
    'font-size': fontSize,
    'font-family': fontFamily,
    fill,
    'text-anchor': anchor,
    'dominant-baseline': 'middle'
  });
  el.textContent = text;
  return el;
}

/**
 * Wrap text to fit within a given width
 * @param {string} text - Text to wrap
 * @param {number} maxWidth - Maximum width in pixels
 * @param {number} fontSize - Font size for estimation
 * @returns {Array<string>} Array of text lines
 */
export function wrapText(text, maxWidth, fontSize = 12) {
  const avgCharWidth = fontSize * 0.6; // Rough estimate
  const charsPerLine = Math.floor(maxWidth / avgCharWidth);
  
  if (charsPerLine <= 0) return [text];
  
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length > charsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines.length ? lines : [text];
}

// ============================================================================
// Filename generation
// ============================================================================

/**
 * Generate a timestamp-based filename for export
 * @param {string} prefix - Filename prefix
 * @param {string} extension - File extension (without dot)
 * @returns {string} Filename like "timeline-2026-01-10-143052.png"
 */
export function generateFilename(prefix = 'timeline', extension = 'png') {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; // 2026-01-10
  const time = now.toTimeString().split(' ')[0].replace(/:/g, ''); // 143052
  return `${prefix}-${date}-${time}.${extension}`;
}

// ============================================================================
// Canvas / Image helpers
// ============================================================================

/**
 * Convert an SVG element to a PNG blob
 * @param {SVGElement} svg - The SVG element to convert
 * @param {number} width - Output width
 * @param {number} height - Output height
 * @returns {Promise<Blob>} PNG blob
 */
export async function svgToPngBlob(svg, width, height) {
  return new Promise((resolve, reject) => {
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      // Fill with white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      
      // Draw the SVG
      ctx.drawImage(img, 0, 0, width, height);
      
      URL.revokeObjectURL(url);
      
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create PNG blob'));
        }
      }, 'image/png');
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG as image'));
    };
    
    img.src = url;
  });
}

/**
 * Trigger a file download
 * @param {Blob} blob - The file blob
 * @param {string} filename - Filename for download
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
