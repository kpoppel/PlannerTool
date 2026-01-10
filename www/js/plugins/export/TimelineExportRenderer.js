/**
 * TimelineExportRenderer.js
 * SVG-based export renderer for timeline screenshots
 * 
 * Generates an SVG representation of:
 * - MainGraph canvas (embedded as image)
 * - Timeline header (month labels)
 * - Feature cards (rectangles with text)
 * - Dependency lines (curves)
 * - User annotations
 */

import { state } from '../../services/State.js';
import { getTimelineMonths, TIMELINE_CONFIG } from '../../components/Timeline.lit.js';
import { laneHeight, computePosition } from '../../components/board-utils.js';
import { 
  createSvgElement, 
  createSvgText, 
  wrapText,
  getViewportBounds,
  svgToPngBlob,
  downloadBlob,
  generateFilename
} from './ExportUtils.js';
import { getAnnotationState, ANNOTATION_COLORS } from '../annotations/index.js';

// ============================================================================
// Constants
// ============================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';
const TIMELINE_HEADER_HEIGHT = 32;
const CARD_BORDER_RADIUS = 6;
const CARD_BORDER_LEFT_WIDTH = 6;
const CARD_PADDING = 8;
const CARD_FONT_SIZE = 11;
const CARD_TITLE_FONT_SIZE = 12;

// ============================================================================
// Main Export Class
// ============================================================================

export class TimelineExportRenderer {
  constructor() {
    this._svg = null;
    this._width = 0;
    this._height = 0;
  }

  /**
   * Export the current timeline view to PNG
   * @param {Object} options - Export options
   * @param {boolean} options.includeAnnotations - Whether to include annotations
   * @param {number} options.scrollLeft - Override scroll left position
   * @param {number} options.scrollTop - Override scroll top position
   * @returns {Promise<void>}
   */
  async exportToPng(options = {}) {
    const { includeAnnotations = true, scrollLeft, scrollTop } = options;
    
    try {
      // Build the SVG
      const svg = await this.buildExportSvg({ includeAnnotations, scrollLeft, scrollTop });
      
      // Convert to PNG
      const blob = await svgToPngBlob(svg, this._width, this._height);
      
      // Download
      const filename = generateFilename('timeline-export', 'png');
      downloadBlob(blob, filename);
      
      return { success: true, filename };
    } catch (error) {
      console.error('[TimelineExportRenderer] Export failed:', error);
      throw error;
    }
  }

  /**
   * Build the complete export SVG
   * @param {Object} options - { includeAnnotations, scrollLeft, scrollTop }
   * @returns {Promise<SVGElement>}
   */
  async buildExportSvg(options = {}) {
    const { includeAnnotations = true, scrollLeft, scrollTop } = options;
    
    // Get viewport bounds, with optional scroll position override
    const viewport = getViewportBounds({ scrollLeft, scrollTop });
    
    // Calculate dimensions: visible width, full vertical height
    this._width = Math.floor(viewport.width);
    this._height = Math.floor(viewport.mainGraphHeight + TIMELINE_HEADER_HEIGHT + viewport.fullHeight);
    
    // Create root SVG
    this._svg = createSvgElement('svg', {
      xmlns: SVG_NS,
      width: this._width,
      height: this._height,
      viewBox: `0 0 ${this._width} ${this._height}`
    });
    
    // Add white background
    const bg = createSvgElement('rect', {
      x: 0,
      y: 0,
      width: this._width,
      height: this._height,
      fill: '#ffffff'
    });
    this._svg.appendChild(bg);
    
    // Layer 1: MainGraph canvas image
    const mainGraphY = 0;
    await this._renderMainGraph(mainGraphY, viewport);
    
    // Layer 2: Timeline header
    const timelineY = viewport.mainGraphHeight;
    this._renderTimelineHeader(timelineY, viewport);
    
    // Layer 3: Feature board background
    const boardY = viewport.mainGraphHeight + TIMELINE_HEADER_HEIGHT;
    this._renderBoardBackground(boardY, viewport);
    
    // Layer 4: Feature cards
    this._renderFeatureCards(boardY, viewport);
    
    // Layer 5: Dependency lines
    this._renderDependencies(boardY, viewport);
    
    // Layer 6: Annotations (if enabled)
    if (includeAnnotations) {
      this._renderAnnotations(viewport);
    }
    
    return this._svg;
  }

  // --------------------------------------------------------------------------
  // Layer Renderers
  // --------------------------------------------------------------------------

  /**
   * Render the MainGraph canvas as an embedded image
   */
  async _renderMainGraph(yOffset, viewport) {
    const mainGraph = document.querySelector('maingraph-lit');
    if (!mainGraph) return;
    
    const canvas = mainGraph.shadowRoot?.querySelector('canvas');
    if (!canvas) return;
    
    try {
      // Get the visible portion of the canvas
      const dataUrl = canvas.toDataURL('image/png');
      
      const img = createSvgElement('image', {
        x: 0,
        y: yOffset,
        width: this._width,
        height: viewport.mainGraphHeight,
        href: dataUrl,
        preserveAspectRatio: 'xMinYMin slice'
      });
      
      this._svg.appendChild(img);
    } catch (e) {
      console.warn('[TimelineExportRenderer] Could not capture MainGraph canvas:', e);
      // Fallback: render a placeholder
      const placeholder = createSvgElement('rect', {
        x: 0,
        y: yOffset,
        width: this._width,
        height: viewport.mainGraphHeight,
        fill: '#b0cbe6'
      });
      this._svg.appendChild(placeholder);
    }
  }

  /**
   * Render the timeline header with month labels
   */
  _renderTimelineHeader(yOffset, viewport) {
    const months = getTimelineMonths() || [];
    const monthWidth = TIMELINE_CONFIG.monthWidth;
    const scrollLeft = viewport.scrollLeft;
    
    // Background
    const headerBg = createSvgElement('rect', {
      x: 0,
      y: yOffset,
      width: this._width,
      height: TIMELINE_HEADER_HEIGHT,
      fill: '#23344d'
    });
    this._svg.appendChild(headerBg);
    
    // Calculate visible months
    const startMonthIdx = Math.floor(scrollLeft / monthWidth);
    const endMonthIdx = Math.min(
      months.length - 1,
      Math.ceil((scrollLeft + this._width) / monthWidth)
    );
    
    // Render month labels
    for (let i = startMonthIdx; i <= endMonthIdx; i++) {
      const month = months[i];
      if (!month) continue;
      
      const x = (i * monthWidth) - scrollLeft + (monthWidth / 2);
      const label = month.toLocaleString('default', { month: 'short', year: '2-digit' });
      
      const text = createSvgText(label, x, yOffset + TIMELINE_HEADER_HEIGHT / 2, {
        fontSize: 12,
        fill: '#ffffff',
        anchor: 'middle'
      });
      this._svg.appendChild(text);
    }
  }

  /**
   * Render the feature board alternating month background
   */
  _renderBoardBackground(yOffset, viewport) {
    const months = getTimelineMonths() || [];
    const monthWidth = TIMELINE_CONFIG.monthWidth;
    const scrollLeft = viewport.scrollLeft;
    const boardHeight = viewport.fullHeight;
    
    // Calculate visible months
    const startMonthIdx = Math.floor(scrollLeft / monthWidth);
    const endMonthIdx = Math.min(
      months.length - 1,
      Math.ceil((scrollLeft + this._width) / monthWidth)
    );
    
    // Render alternating stripes
    for (let i = startMonthIdx; i <= endMonthIdx; i++) {
      const x = (i * monthWidth) - scrollLeft;
      const fill = i % 2 === 0 ? '#f7f7f7' : '#ececec';
      
      // Calculate visible portion of the stripe
      const visibleX = Math.max(0, x);
      const stripeEnd = x + monthWidth;
      const visibleEnd = Math.min(stripeEnd, this._width);
      const visibleWidth = visibleEnd - visibleX;
      
      // Skip if not visible
      if (visibleWidth <= 0) continue;
      
      const stripe = createSvgElement('rect', {
        x: visibleX,
        y: yOffset,
        width: visibleWidth,
        height: boardHeight,
        fill
      });
      this._svg.appendChild(stripe);
    }
  }

  /**
   * Render feature cards as SVG rectangles
   */
  _renderFeatureCards(yOffset, viewport) {
    const featureBoard = document.querySelector('feature-board');
    if (!featureBoard) return;
    
    const months = getTimelineMonths() || [];
    const scrollLeft = viewport.scrollLeft;
    const cardHeight = laneHeight();
    
    // Get visible features from the board's current render state
    const features = featureBoard.features || [];
    
    for (const featureObj of features) {
      const { feature, left, width, top, project } = featureObj;
      
      // Adjust for scroll
      const cardX = left - scrollLeft;
      const cardY = yOffset + top;
      
      // Skip if completely outside viewport
      if (cardX + width < 0 || cardX > this._width) continue;
      
      // Clamp to visible area - properly handle cards starting before viewport
      const visibleX = Math.max(0, cardX);
      const clippedLeft = visibleX - cardX;  // Amount clipped on the left side
      const visibleWidth = Math.min(width - clippedLeft, this._width - visibleX);
      const isLeftClipped = clippedLeft > 0;
      const isRightClipped = cardX + width > this._width;
      
      if (visibleWidth <= 0) continue;
      
      // Card background - adjust corner radius based on clipping
      const cardBg = createSvgElement('rect', {
        x: visibleX,
        y: cardY + 2,
        width: visibleWidth,
        height: cardHeight - 4,
        rx: isLeftClipped ? 0 : CARD_BORDER_RADIUS,
        ry: isRightClipped ? 0 : CARD_BORDER_RADIUS,
        fill: feature.dirty ? '#ffe5c2' : '#ffffff',
        stroke: '#cccccc',
        'stroke-width': 1
      });
      this._svg.appendChild(cardBg);
      
      // Project color border on left - only show if left edge is visible
      if (!isLeftClipped) {
        const projectColor = project?.color || '#666666';
        const borderLeft = createSvgElement('rect', {
          x: visibleX,
          y: cardY + 2,
          width: CARD_BORDER_LEFT_WIDTH,
          height: cardHeight - 4,
          rx: CARD_BORDER_RADIUS,
          ry: CARD_BORDER_RADIUS,
          fill: projectColor
        });
        this._svg.appendChild(borderLeft);
        
        // Clip the right side of the border to match card shape
        const borderClip = createSvgElement('rect', {
          x: visibleX + CARD_BORDER_RADIUS,
          y: cardY + 2,
          width: CARD_BORDER_LEFT_WIDTH - CARD_BORDER_RADIUS,
          height: cardHeight - 4,
          fill: projectColor
        });
        this._svg.appendChild(borderClip);
      }
      
      // Title text - show if card is wide enough
      // For left-clipped cards, show title starting at left edge (may overflow right)
      if (visibleWidth > 40) {
        const title = feature.title || feature.name || `#${feature.id}`;
        const textX = isLeftClipped 
          ? visibleX + CARD_PADDING  // Start from visible left edge
          : visibleX + CARD_BORDER_LEFT_WIDTH + CARD_PADDING;  // After project color border
        
        // For left-clipped cards, allow text to overflow; otherwise truncate to fit
        const truncatedTitle = isLeftClipped 
          ? title  // Allow overflow
          : this._truncateText(title, visibleWidth - CARD_PADDING * 2 - CARD_BORDER_LEFT_WIDTH);
        
        const titleText = createSvgText(
          truncatedTitle,
          textX,
          cardY + cardHeight / 2,
          {
            fontSize: CARD_TITLE_FONT_SIZE,
            fill: '#333333',
            anchor: 'start'
          }
        );
        this._svg.appendChild(titleText);
      }
    }
  }

  /**
   * Render dependency lines between cards
   */
  _renderDependencies(yOffset, viewport) {
    const featureBoard = document.querySelector('feature-board');
    if (!featureBoard) return;
    
    const scrollLeft = viewport.scrollLeft;
    const cardHeight = laneHeight();
    const features = featureBoard.features || [];
    
    // Build a map of feature positions
    const positionById = new Map();
    for (const featureObj of features) {
      const { feature, left, width, top } = featureObj;
      positionById.set(String(feature.id), {
        left: left - scrollLeft,
        width,
        top: yOffset + top,
        height: cardHeight
      });
    }
    
    // Get all features with relations
    const allFeatures = state.getEffectiveFeatures?.() || [];
    const drawn = new Set();
    
    for (const f of allFeatures) {
      const relations = Array.isArray(f.relations) ? f.relations : null;
      if (!relations) continue;
      
      const targetPos = positionById.get(String(f.id));
      if (!targetPos) continue;
      
      for (const rel of relations) {
        let otherId = null;
        let relType = 'Related';
        
        if (typeof rel === 'string' || typeof rel === 'number') {
          otherId = String(rel);
          relType = 'Predecessor';
        } else if (rel && rel.id) {
          otherId = String(rel.id);
          relType = rel.type || rel.relationType || 'Related';
        } else {
          continue;
        }
        
        if (relType === 'Child' || relType === 'Parent') continue;
        
        const otherPos = positionById.get(String(otherId));
        if (!otherPos) continue;
        
        // Avoid drawing duplicates
        const key = [otherId, f.id].sort().join('::');
        if (drawn.has(key)) continue;
        drawn.add(key);
        
        // Calculate connection points
        let from, to;
        if (relType === 'Successor') {
          from = { x: targetPos.left + targetPos.width, y: targetPos.top + targetPos.height / 2 };
          to = { x: otherPos.left, y: otherPos.top + otherPos.height / 2 };
        } else if (relType === 'Predecessor') {
          from = { x: otherPos.left + otherPos.width, y: otherPos.top + otherPos.height / 2 };
          to = { x: targetPos.left, y: targetPos.top + targetPos.height / 2 };
        } else {
          from = { x: otherPos.left + otherPos.width / 2, y: otherPos.top + otherPos.height / 2 };
          to = { x: targetPos.left + targetPos.width / 2, y: targetPos.top + targetPos.height / 2 };
        }
        
        // Draw bezier curve
        const dx = Math.max(20, Math.abs(to.x - from.x) * 0.4);
        const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
        
        const path = createSvgElement('path', {
          d,
          fill: 'none',
          stroke: relType === 'Related' ? '#6a6' : '#888',
          'stroke-width': relType === 'Related' ? 1.5 : 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        });
        
        if (relType === 'Related') {
          path.setAttribute('stroke-dasharray', '6,4');
        }
        
        this._svg.appendChild(path);
      }
    }
  }

  /**
   * Render user annotations
   * Annotations are stored in content coordinates (relative to timeline section content).
   * The timeline section contains both the timeline header AND the feature board.
   * In the export, we need to:
   * - Subtract scrollLeft for X (since export starts at scrollLeft)
   * - Add mainGraphHeight for Y (export has MainGraph at top, then timeline section)
   * Note: We do NOT add TIMELINE_HEADER_HEIGHT because the timelineSection already
   * includes the timeline header - annotations at y=0 are at the top of the header.
   */
  _renderAnnotations(viewport) {
    const annotationState = getAnnotationState();
    const annotations = annotationState.annotations;
    
    // Offset: MainGraph is above timelineSection in export
    // Timeline header is PART of timelineSection, so no need to add TIMELINE_HEADER_HEIGHT
    const yOffset = viewport.mainGraphHeight;
    const xOffset = -viewport.scrollLeft;  // Subtract scroll to get export coords
    
    for (const ann of annotations) {
      switch (ann.type) {
        case 'note':
          this._renderNoteAnnotation(ann, xOffset, yOffset);
          break;
        case 'rect':
          this._renderRectAnnotation(ann, xOffset, yOffset);
          break;
        case 'line':
          this._renderLineAnnotation(ann, xOffset, yOffset);
          break;
      }
    }
  }

  _renderNoteAnnotation(ann, xOffset = 0, yOffset = 0) {
    const x = ann.x + xOffset;
    const y = ann.y + yOffset;
    
    // Skip if completely outside visible export area
    if (x + ann.width < 0 || x > this._width) return;
    
    // Background rect
    const bg = createSvgElement('rect', {
      x,
      y,
      width: ann.width,
      height: ann.height,
      rx: 4,
      ry: 4,
      fill: ann.fill || ANNOTATION_COLORS.defaultFill,
      stroke: ann.stroke || ANNOTATION_COLORS.defaultStroke,
      'stroke-width': 1
    });
    this._svg.appendChild(bg);
    
    // Text with wrapping
    const lines = wrapText(ann.text || '', ann.width - 12, ann.fontSize || 12);
    const lineHeight = (ann.fontSize || 12) * 1.3;
    const startY = y + 12;
    
    for (let i = 0; i < lines.length; i++) {
      const text = createSvgText(
        lines[i],
        x + 6,
        startY + i * lineHeight,
        {
          fontSize: ann.fontSize || 12,
          fill: ANNOTATION_COLORS.textColor,
          anchor: 'start'
        }
      );
      // Adjust baseline for proper alignment
      text.setAttribute('dominant-baseline', 'hanging');
      this._svg.appendChild(text);
    }
  }

  _renderRectAnnotation(ann, xOffset = 0, yOffset = 0) {
    const x = ann.x + xOffset;
    const y = ann.y + yOffset;
    
    // Skip if completely outside visible export area
    if (x + ann.width < 0 || x > this._width) return;
    
    const rect = createSvgElement('rect', {
      x,
      y,
      width: ann.width,
      height: ann.height,
      fill: ann.fill || 'transparent',
      stroke: ann.stroke || ANNOTATION_COLORS.lineColor,
      'stroke-width': ann.strokeWidth || 2,
      rx: 2,
      ry: 2
    });
    this._svg.appendChild(rect);
  }

  _renderLineAnnotation(ann, xOffset = 0, yOffset = 0) {
    const x1 = ann.x1 + xOffset;
    const y1 = ann.y1 + yOffset;
    const x2 = ann.x2 + xOffset;
    const y2 = ann.y2 + yOffset;
    
    // Skip if completely outside (rough check)
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    if (maxX < 0 || minX > this._width) return;
    
    const line = createSvgElement('line', {
      x1,
      y1,
      x2,
      y2,
      stroke: ann.stroke || ANNOTATION_COLORS.lineColor,
      'stroke-width': ann.strokeWidth || 2,
      'stroke-linecap': 'round'
    });
    this._svg.appendChild(line);
    
    // Arrow head if enabled
    if (ann.arrow) {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const arrowLen = 10;
      const arrowAngle = Math.PI / 6;
      
      const ax3 = x2 - arrowLen * Math.cos(angle - arrowAngle);
      const ay3 = y2 - arrowLen * Math.sin(angle - arrowAngle);
      const ax4 = x2 - arrowLen * Math.cos(angle + arrowAngle);
      const ay4 = y2 - arrowLen * Math.sin(angle + arrowAngle);
      
      const arrowHead = createSvgElement('path', {
        d: `M ${x2} ${y2} L ${ax3} ${ay3} M ${x2} ${y2} L ${ax4} ${ay4}`,
        fill: 'none',
        stroke: ann.stroke || ANNOTATION_COLORS.lineColor,
        'stroke-width': ann.strokeWidth || 2,
        'stroke-linecap': 'round'
      });
      this._svg.appendChild(arrowHead);
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  _truncateText(text, maxWidth, fontSize = CARD_TITLE_FONT_SIZE) {
    const avgCharWidth = fontSize * 0.6;
    const maxChars = Math.floor(maxWidth / avgCharWidth);
    
    if (text.length <= maxChars) return text;
    if (maxChars <= 3) return '…';
    
    return text.substring(0, maxChars - 1) + '…';
  }
}

// ============================================================================
// Singleton accessor
// ============================================================================

let _rendererInstance = null;

/**
 * Get the singleton export renderer instance
 * @returns {TimelineExportRenderer}
 */
export function getExportRenderer() {
  if (!_rendererInstance) {
    _rendererInstance = new TimelineExportRenderer();
  }
  return _rendererInstance;
}

/**
 * Quick export function
 * @param {Object} options - { includeAnnotations }
 * @returns {Promise<{success: boolean, filename?: string}>}
 */
export async function exportTimelineToPng(options = {}) {
  const renderer = getExportRenderer();
  return renderer.exportToPng(options);
}
