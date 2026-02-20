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
import { getBoardOffset } from '../../components/board-utils.js';
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
import { epicSvgElement, featureSvgElement } from '../../services/IconService.js';

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
const ICON_SIZE = 16;
const ICON_GAP = 4;

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
    const { includeAnnotations = true, includeDependencies = true, scrollLeft, scrollTop } = options;
    
    try {
      // Build the SVG
      const svg = await this.buildExportSvg({ includeAnnotations, includeDependencies, scrollLeft, scrollTop });
      
      // Convert to PNG
      const blob = await svgToPngBlob(svg, this._width, this._height);

      // Download by default
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
    const { includeAnnotations = true, includeDependencies = true, scrollLeft, scrollTop } = options;
    
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
    
    // Layer 4.5: Ghost titles (for overflowing titles)
    this._renderGhostTitles(boardY, viewport);
    
    // Layer 5: Dependency lines
    this._renderDependencies(boardY, viewport, includeDependencies);
    
    // Layer 6: Annotations (if enabled)
    if (includeAnnotations) {
      this._renderAnnotations(viewport);
    }
    
    return this._svg;
  }

  /**
   * Build SVG and return the SVG element (public)
   * @param {Object} options
   * @returns {Promise<SVGElement>}
   */
  async getExportSvg(options = {}) {
    // Ensure buildExportSvg sets internal width/height
    return this.buildExportSvg(options);
  }

  /**
   * Return PNG blob for given options without downloading
   * @param {Object} options
   * @returns {Promise<Blob>}
   */
  async exportToPngBlob(options = {}) {
    const svg = await this.buildExportSvg(options);
    const blob = await svgToPngBlob(svg, this._width, this._height);
    return blob;
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
    
    // Track card data for ghost title rendering
    this._cardData = [];
    
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
      
      // Create a group for this card so we can control drawing order
      const cardGroup = createSvgElement('g', { transform: `translate(0,0)` });

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
      cardGroup.appendChild(cardBg);
      
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
        cardGroup.appendChild(borderLeft);
        
        // Clip the right side of the border to match card shape
        const borderClip = createSvgElement('rect', {
          x: visibleX + CARD_BORDER_RADIUS,
          y: cardY + 2,
          width: CARD_BORDER_LEFT_WIDTH - CARD_BORDER_RADIUS,
          height: cardHeight - 4,
          fill: projectColor
        });
        cardGroup.appendChild(borderClip);
      }
      
      // Title text - show if card is wide enough
      // For left-clipped cards, show title starting at left edge (may overflow right)
      const title = feature.title || feature.name || `#${feature.id}`;
      let titleOverflows = false;
      
      if (visibleWidth > 40) {
        const baseTextX = isLeftClipped 
          ? visibleX + CARD_PADDING  // Start from visible left edge
          : visibleX + CARD_BORDER_LEFT_WIDTH + CARD_PADDING;  // After project color border

        // Determine if we should render a type icon (match FeatureCard.lit layout)
        const hasTypeIcon = !isLeftClipped && (feature.type === 'epic' || feature.type === 'feature');
        const iconReserve = hasTypeIcon ? (ICON_SIZE + ICON_GAP) : 0;
        const textX = baseTextX + iconReserve;

        // For left-clipped cards, allow text to overflow; otherwise truncate to fit
        const availableWidth = visibleWidth - CARD_PADDING * 2 - CARD_BORDER_LEFT_WIDTH - iconReserve;
        const truncatedTitle = isLeftClipped 
          ? title  // Allow overflow
          : this._truncateText(title, availableWidth);
        
        titleOverflows = !isLeftClipped && truncatedTitle.endsWith('…');

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
        cardGroup.appendChild(titleText);

        // Render type icon (if applicable) to the left of the title
        if (hasTypeIcon) {
          const iconX = baseTextX; // place icon at base text start (before textX)
          const iconY = cardY + (cardHeight - ICON_SIZE) / 2;

          if (feature.type === 'epic') {
            const node = epicSvgElement({ x: iconX, y: iconY, width: ICON_SIZE, height: ICON_SIZE });
            if (node) cardGroup.appendChild(node);
          } else if (feature.type === 'feature') {
            const node = featureSvgElement({ x: iconX, y: iconY, width: ICON_SIZE, height: ICON_SIZE });
            if (node) cardGroup.appendChild(node);
          }
        }
      }
      
      // Store card data for ghost title rendering
      // Small cards (<40px) or overflowing titles should show ghosts
      const isSmallCard = visibleWidth <= 40;
      if (isSmallCard || titleOverflows) {
        this._cardData.push({
          feature,
          project,
          title,
          left,
          cardX,
          cardY,
          width,
          height: cardHeight,
          scrollLeft,
          visibleX,
          visibleWidth,
          isLeftClipped,
          isRightClipped
        });
      }

      // Append the assembled card group to the root svg so it sits above board background
      this._svg.appendChild(cardGroup);
    }
  }

  /**
   * Render ghost titles for overflowing feature card titles
   * Matches styling from GhostTitle.lit.js
   */
  _renderGhostTitles(yOffset, viewport) {
    if (!this._cardData || this._cardData.length === 0) return;
    
    // Match GhostTitle.lit.js styling
    const GHOST_PADDING_VERTICAL = 2;
    const GHOST_PADDING_HORIZONTAL = 6;
    const GHOST_GAP = 12; // Match the gap in GhostTitle.lit.js
    const GHOST_FONT_SIZE = CARD_TITLE_FONT_SIZE * 0.9; // 0.9em
    const GHOST_LINE_HEIGHT = GHOST_FONT_SIZE * 1.1; // line-height: 1.1
    const ARROW_SIZE = 10;
    const BORDER_LEFT_WIDTH_STUCK = 6;
    for (const cardData of this._cardData) {
      const { feature, project, title, left, cardX, cardY, width, height, scrollLeft } = cardData;
      
      // Split title like GhostTitle.lit.js does
      const words = title.split(/\s+/);
      let lines = [];
      
      if (words.length < 4) {
        // Short title - use as single line
        lines = [title];
      } else {
        // Split at middle
        const mid = Math.floor(words.length / 2);
        lines = [
          words.slice(0, mid).join(' '),
          words.slice(mid).join(' ')
        ];
      }
      
      // Calculate ghost width based on longest line
      // Using 0.7 * fontSize as character width (conservative estimate)
      const charWidth = GHOST_FONT_SIZE * 0.7;
      let maxLineLength = 0;
      for (const line of lines) {
        if (line.length > maxLineLength) {
          maxLineLength = line.length;
        }
      }
      
      // Ghost width = text width + padding + extra buffer for safety
      const ghostWidth = maxLineLength * charWidth + GHOST_PADDING_HORIZONTAL * 2 + 30;
      const ghostHeight = GHOST_PADDING_VERTICAL * 2 + lines.length * GHOST_LINE_HEIGHT;
      
      // Calculate ghost position using the same logic as GhostTitle.lit.js
      // cardLeft is the absolute position on the board
      const cardLeft = left;
      const cardInViewportX = cardLeft - scrollLeft;
      const cardRightInViewportX = cardInViewportX + width;
      
      // Check if card is visible in viewport
      const cardLeftVisible = cardInViewportX >= 0 && cardInViewportX <= this._width;
      const cardRightVisible = cardRightInViewportX >= 0 && cardRightInViewportX <= this._width;
      const isCardOnScreen = cardLeftVisible || cardRightVisible;
      
      let ghostLeft;
      let stuckToEdge = false;
      
      if (isCardOnScreen) {
        // Card is on-screen: position ghost to the left of the card
        // Account for ghost width + gap + arrow
        ghostLeft = cardLeft - ghostWidth - GHOST_GAP - ARROW_SIZE;
        
        // Clamp ghostLeft to not go off the left edge of visible area
        if (ghostLeft < scrollLeft) {
          ghostLeft = scrollLeft + GHOST_GAP;
          stuckToEdge = true;
        }
      } else {
        // Card is off-screen: stick ghost to the visible edge
        stuckToEdge = true;
        if (cardRightInViewportX < 0) {
          // Card is off-screen to the left: stick ghost to left edge with gap
          ghostLeft = scrollLeft + GHOST_GAP;
        } else if (cardInViewportX > this._width) {
          // Card is off-screen to the right: stick ghost to right edge (but we probably won't have these)
          ghostLeft = scrollLeft + this._width - ghostWidth - GHOST_GAP - ARROW_SIZE;
        } else {
          // Fallback to normal positioning
          ghostLeft = cardLeft - ghostWidth - GHOST_GAP - ARROW_SIZE;
          if (ghostLeft < scrollLeft) {
            ghostLeft = scrollLeft + GHOST_GAP;
          }
        }
      }
      
      // Convert to viewport coordinates for rendering
      const ghostX = ghostLeft - scrollLeft;
      const ghostY = cardY + (height - ghostHeight) / 2;
      
      // Create ghost group
      const ghostGroup = createSvgElement('g', { class: 'ghost-title' });
      
      // Background rect - transparent fill with dashed border
      const bgRect = createSvgElement('rect', {
        x: ghostX,
        y: ghostY,
        width: ghostWidth,
        height: ghostHeight,
        rx: 4,
        ry: 4,
        fill: 'none',
        stroke: 'rgba(0,0,0,0.25)',
        'stroke-width': 1,
        'stroke-dasharray': '3,3'
      });
      ghostGroup.appendChild(bgRect);
      
      // Solid border when stuck to edge
      if (stuckToEdge) {
        const projectColor = project?.color || '#666666';
        const solidBorder = createSvgElement('rect', {
          x: ghostX,
          y: ghostY,
          width: BORDER_LEFT_WIDTH_STUCK,
          height: ghostHeight,
          rx: 4,
          ry: 4,
          fill: projectColor
        });
        ghostGroup.appendChild(solidBorder);
        
        // Clip right side to square it off
        const borderClip = createSvgElement('rect', {
          x: ghostX + 4,
          y: ghostY,
          width: BORDER_LEFT_WIDTH_STUCK - 4,
          height: ghostHeight,
          fill: projectColor
        });
        ghostGroup.appendChild(borderClip);
      }
      
      // Render text lines
      const textX = ghostX + GHOST_PADDING_HORIZONTAL;
      const firstLineY = ghostY + GHOST_PADDING_VERTICAL + GHOST_FONT_SIZE;
      
      for (let i = 0; i < lines.length; i++) {
        const lineY = firstLineY + i * GHOST_LINE_HEIGHT;
        const lineText = createSvgText(
          lines[i],
          textX,
          lineY,
          {
            fontSize: GHOST_FONT_SIZE,
            fill: 'rgba(0,0,0,0.75)',
            anchor: 'start'
          }
        );
        ghostGroup.appendChild(lineText);
      }
      
      // Arrow pointing to card (right-pointing triangle on right edge)
      const arrowX = ghostX + ghostWidth;
      const arrowY = ghostY + ghostHeight / 2;
      const arrow = createSvgElement('polygon', {
        points: `${arrowX},${arrowY - ARROW_SIZE} ${arrowX + ARROW_SIZE},${arrowY} ${arrowX},${arrowY + ARROW_SIZE}`,
        fill: 'rgba(0,0,0,0.1)'
      });
      ghostGroup.appendChild(arrow);
      
      // Append ghost to SVG
      this._svg.appendChild(ghostGroup);
    }
  }

  /**
   * Render dependency lines between cards
   */
  _renderDependencies(yOffset, viewport, includeDependencies = undefined) {
    // If the caller explicitly requests dependencies disabled, skip rendering
    if (includeDependencies === false) return;
    // If caller did not specify, fall back to the global view setting
    if (includeDependencies === undefined && !state.showDependencies) return;

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
    // The export layout places the timeline header below the main graph and
    // above the feature board. Annotations are stored relative to the
    // timelineSection content origin (which includes the timeline header at y=0),
    // so we must add both the main graph height AND the explicit timeline
    // header height to align annotations with the exported board content.
    const yOffset = viewport.mainGraphHeight + TIMELINE_HEADER_HEIGHT;
    // X offset: subtract scrollLeft so content X coordinates map into the
    // exported viewport (contentX + xOffset -> svg X coordinate)
    const xOffset = -viewport.scrollLeft;
    
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
        case 'icon':
          this._renderIconAnnotation(ann, xOffset, yOffset);
          break;
      }
    }
  }

  _renderIconAnnotation(ann, xOffset = 0, yOffset = 0) {
    const contentX = (ann.date) ? (function(){
      const months = getTimelineMonths() || [];
      const monthWidth = TIMELINE_CONFIG.monthWidth || 120;
      const boardOffset = getBoardOffset() || 0;
      if (!months.length) return boardOffset;
      const d = new Date(ann.date);
      let idx = months.findIndex(m => m.getFullYear()===d.getFullYear() && m.getMonth()===d.getMonth());
      if (idx === -1) idx = months.reduce((acc, m, i) => (m.getTime() <= d.getTime() ? i : acc), 0);
      const monthStart = months[idx];
      const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 0).getDate();
      const fraction = Math.max(0, Math.min(1, (d.getDate()-1) / daysInMonth));
      return Math.round(boardOffset + (idx + fraction) * monthWidth);
    })() : (ann.x || 0);

    const x = contentX + xOffset;
    const y = ann.y + yOffset;
    const size = ann.size || 18;

    // Skip if off-canvas
    if (x + size < 0 || x - size > this._width) return;

    const txt = createSvgText(ann.icon || '⭐', x, y + size / 2, {
      'font-size': size,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle'
    });
    this._svg.appendChild(txt);
  }

  _renderNoteAnnotation(ann, xOffset = 0, yOffset = 0) {
    const contentX = (ann.date) ? (function(){
      const months = getTimelineMonths() || [];
      const monthWidth = TIMELINE_CONFIG.monthWidth || 120;
      const boardOffset = getBoardOffset() || 0;
      if (!months.length) return boardOffset;
      const d = new Date(ann.date);
      let idx = months.findIndex(m => m.getFullYear()===d.getFullYear() && m.getMonth()===d.getMonth());
      if (idx === -1) idx = months.reduce((acc, m, i) => (m.getTime() <= d.getTime() ? i : acc), 0);
      const monthStart = months[idx];
      const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 0).getDate();
      const fraction = Math.max(0, Math.min(1, (d.getDate()-1) / daysInMonth));
      return Math.round(boardOffset + (idx + fraction) * monthWidth);
    })() : (ann.x || 0);
    const x = contentX + xOffset;
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
    const contentX = (ann.date) ? (function(){
      const months = getTimelineMonths() || [];
      const monthWidth = TIMELINE_CONFIG.monthWidth || 120;
      const boardOffset = getBoardOffset() || 0;
      if (!months.length) return boardOffset;
      const d = new Date(ann.date);
      let idx = months.findIndex(m => m.getFullYear()===d.getFullYear() && m.getMonth()===d.getMonth());
      if (idx === -1) idx = months.reduce((acc, m, i) => (m.getTime() <= d.getTime() ? i : acc), 0);
      const monthStart = months[idx];
      const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 0).getDate();
      const fraction = Math.max(0, Math.min(1, (d.getDate()-1) / daysInMonth));
      return Math.round(boardOffset + (idx + fraction) * monthWidth);
    })() : (ann.x || 0);
    const x = contentX + xOffset;
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
    const contentX1 = (ann.date1) ? (function(){
      const months = getTimelineMonths() || [];
      const monthWidth = TIMELINE_CONFIG.monthWidth || 120;
      const boardOffset = getBoardOffset() || 0;
      if (!months.length) return boardOffset;
      const d = new Date(ann.date1);
      let idx = months.findIndex(m => m.getFullYear()===d.getFullYear() && m.getMonth()===d.getMonth());
      if (idx === -1) idx = months.reduce((acc, m, i) => (m.getTime() <= d.getTime() ? i : acc), 0);
      const monthStart = months[idx];
      const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 0).getDate();
      const fraction = Math.max(0, Math.min(1, (d.getDate()-1) / daysInMonth));
      return Math.round(boardOffset + (idx + fraction) * monthWidth);
    })() : (ann.x1 || 0);
    const contentX2 = (ann.date2) ? (function(){
      const months = getTimelineMonths() || [];
      const monthWidth = TIMELINE_CONFIG.monthWidth || 120;
      const boardOffset = getBoardOffset() || 0;
      if (!months.length) return boardOffset;
      const d = new Date(ann.date2);
      let idx = months.findIndex(m => m.getFullYear()===d.getFullYear() && m.getMonth()===d.getMonth());
      if (idx === -1) idx = months.reduce((acc, m, i) => (m.getTime() <= d.getTime() ? i : acc), 0);
      const monthStart = months[idx];
      const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 0).getDate();
      const fraction = Math.max(0, Math.min(1, (d.getDate()-1) / daysInMonth));
      return Math.round(boardOffset + (idx + fraction) * monthWidth);
    })() : (ann.x2 || 0);
    const x1 = contentX1 + xOffset;
    const y1 = ann.y1 + yOffset;
    const x2 = contentX2 + xOffset;
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
