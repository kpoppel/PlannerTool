/**
 * PluginMarkersComponent - Displays delivery plan markers as timeline overlay
 */
import { LitElement, html, css } from '../vendor/lit.js';
import { TIMELINE_CONFIG, getTimelineMonths } from '../components/Timeline.lit.js';
import { bus } from '../core/EventBus.js';
import { TimelineEvents, ProjectEvents, TeamEvents } from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';
import { getBoardOffset } from '../components/board-utils.js';
import { state } from '../services/State.js';

export class PluginMarkersComponent extends LitElement {
  static properties = { 
    visible: { type: Boolean },
    markers: { type: Array },
    loading: { type: Boolean },
    selectedColors: { type: Object }
  };
  
  constructor() { 
    super(); 
    this.visible = false;
    this.markers = [];
    this.loading = false;
    this._svgEl = null;
    this._scrollScheduled = false;
    this._overlay = null;
    this.selectedColors = {}; // Map of color -> boolean
  }

  static styles = css`
    :host { 
      display: none;
      position: fixed;
      z-index: 200;
      pointer-events: none;
    }
    
    :host([visible]) { display: block; }

    .floating-toolbar {
      position: fixed;
      top: 80px;
      right: 20px;
      background: white;
      padding: 12px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      pointer-events: auto;
      z-index: 200;
      min-width: 140px;
    }
    
    .toolbar-title {
      font-size: 12px;
      font-weight: 600;
      color: #666;
      margin-bottom: 8px;
      text-transform: uppercase;
    }

    button {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
      font-size: 13px;
      width: 100%;
      margin-bottom: 4px;
    }
    
    button:hover {
      background: #f5f5f5;
      border-color: #ccc;
    }

    .close-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      padding: 0;
      background: transparent;
      border: none;
      color: #999;
      font-size: 16px;
      margin: 0;
    }

    .close-btn:hover {
      color: #333;
      background: #f0f0f0;
    }

    .marker-count {
      font-size: 11px;
      background: #E8F5E9;
      color: #2E7D32;
      padding: 2px 6px;
      border-radius: 10px;
      margin-top: 8px;
      display: inline-block;
    }
    
    .color-filters {
      margin-top: 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    
    .color-filter-btn {
      width: 20px;
      height: 20px;
      border: 2px solid #ccc;
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .color-filter-btn.selected {
      border-color: #000;
      box-shadow: 0 0 0 1px #000;
    }
    
    .color-filter-btn:hover {
      transform: scale(1.1);
    }
  `;


  connectedCallback() {
    super.connectedCallback();
    
    this._timelineListener = () => {
      if (this.visible) {
        if (!this._scrollScheduled) {
          this._scrollScheduled = true;
          requestAnimationFrame(() => {
            this._scrollScheduled = false;
            this._updateMarkers();
          });
        }
      }
    };
    
    bus.on(TimelineEvents.MONTHS_CHANGED, this._timelineListener);
    bus.on(TimelineEvents.SCALE_CHANGED, this._timelineListener);
    
    // Listen for project/team selection changes
    this._selectionListener = () => {
      if (this.visible) {
        // Use requestAnimationFrame to ensure state is updated
        requestAnimationFrame(() => {
          this._updateMarkers();
          this.requestUpdate(); // Trigger re-render to update toolbar count
        });
      }
    };
    
    bus.on(ProjectEvents.CHANGED, this._selectionListener);
    bus.on(TeamEvents.CHANGED, this._selectionListener);
    
    const board = document.querySelector('feature-board');
    if (board) {
      this._scrollListener = () => {
        if (this.visible && !this._scrollScheduled) {
          this._scrollScheduled = true;
          requestAnimationFrame(() => {
            this._scrollScheduled = false;
            this._updateMarkers();
          });
        }
      };
      board.addEventListener('scroll', this._scrollListener);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    
    if (this._timelineListener) {
      bus.off(TimelineEvents.MONTHS_CHANGED, this._timelineListener);
      bus.off(TimelineEvents.SCALE_CHANGED, this._timelineListener);
    }
    
    if (this._selectionListener) {
      bus.off(ProjectEvents.CHANGED, this._selectionListener);
      bus.off(TeamEvents.CHANGED, this._selectionListener);
    }
    
    if (this._scrollListener) {
      const board = document.querySelector('feature-board');
      board?.removeEventListener('scroll', this._scrollListener);
    }
    
    if (this._syncOverlayScroll) {
      const board = document.querySelector('feature-board');
      board?.removeEventListener('scroll', this._syncOverlayScroll);
    }
    
    this._overlay?.remove();
    this._overlay = null;
    this._svgEl = null;
  }

  firstUpdated() {
    const board = document.querySelector('feature-board');
    if (!board) return;
    
    const hostRoot = board.shadowRoot || board;
    let overlay = hostRoot.querySelector('.markers-overlay-svg');
    
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'markers-overlay-svg';
      
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'markers-svg');
      overlay.appendChild(svg);
      hostRoot.appendChild(overlay);
      
      Object.assign(overlay.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '5',
        overflow: 'hidden',
        display: 'block' // Ensure it's visible initially
      });
    }

    this._overlay = overlay;
    this._svgEl = overlay.querySelector('.markers-svg');
    
    // Ensure overlay scrolls with board content
    if (board) {
      this._syncOverlayScroll = () => {
        if (this._overlay) {
          this._overlay.style.transform = `translateY(${board.scrollTop}px)`;
        }
      };
      board.addEventListener('scroll', this._syncOverlayScroll);
      this._syncOverlayScroll(); // Initial sync
    }
    
    if (this._svgEl) {
      Object.assign(this._svgEl.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none'
      });
    }
  }

  updated(changedProperties) {
    if (changedProperties.has('markers') || changedProperties.has('visible')) {
      this._updateMarkers();
    }
  }

  render() {
    // Calculate unique total marker count
    let totalUniqueCount = 0;
    if (this.markers.length > 0) {
      const seen = new Set();
      totalUniqueCount = this.markers.filter(m => {
        if (!m.marker?.date) return false;
        const key = `${m.plan_id}:${m.marker.date}:${m.marker.label || m.marker.title || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).length;
    }
    
    // Calculate filtered count for display
    let displayCount = totalUniqueCount;
    if (this.visible && this.markers.length > 0) {
      const selectedProjects = (state.projects || []).filter(p => p.selected).map(p => p.id);
      const selectedTeams = (state.teams || []).filter(t => t.selected).map(t => t.id);
      
      const hasProjectSelection = selectedProjects.length > 0;
      const hasTeamSelection = selectedTeams.length > 0;
      
      // If nothing is selected, show nothing (same as feature board behavior)
      if (!hasProjectSelection || !hasTeamSelection) {
        displayCount = 0;
      } else {
        const filtered = this.markers.filter(m => {
          const projectMatch = selectedProjects.includes(m.project);
          // If marker has no team_id, treat it as matching any team (team-agnostic marker)
          const teamMatch = !m.team_id || selectedTeams.includes(m.team_id);
          // Check color filter
          const markerColor = m.marker?.color || '#2196F3';
          const colorMatch = this.selectedColors[markerColor] !== false;
          return projectMatch && teamMatch && colorMatch;
        });
        
        // Deduplicate by plan_id + date + label
        const seen = new Set();
        displayCount = filtered.filter(m => {
          if (!m.marker?.date) return false;
          const key = `${m.plan_id}:${m.marker.date}:${m.marker.label || m.marker.title || ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).length;
      }
    }
    
    return this.visible ? html`
      <div class="floating-toolbar">
        <button class="close-btn" @click="${this.close}" title="Close">×</button>
        <div class="toolbar-title">Plan Markers</div>
        <button @click="${this.refresh}" ?disabled="${this.loading}">
          ${this.loading ? '⏳ Loading...' : '🔄 Refresh'}
        </button>
        ${!this.loading && totalUniqueCount > 0 ? html`
          <div class="marker-count">
            ${displayCount} ${displayCount !== totalUniqueCount ? `of ${totalUniqueCount}` : ''} markers
          </div>
        ` : ''}
        ${!this.loading && displayCount > 0 && displayCount !== totalUniqueCount ? html`
          <div style="font-size: 10px; color: #666; margin-top: 4px;">
            Filtered by selected teams/projects
          </div>
        ` : ''}
        ${!this.loading && this._getUniqueColors().length > 0 ? html`
          <div class="color-filters">
            ${this._getUniqueColors().map(color => html`
              <div
                class="color-filter-btn ${this.selectedColors[color] !== false ? 'selected' : ''}"
                style="background-color: ${color}"
                @click="${() => this._toggleColor(color)}"
                title="${color}: ${this.selectedColors[color] !== false ? 'Hide' : 'Show'}"
              ></div>
            `)}
          </div>
        ` : ''}
      </div>
    ` : '';
  }

  async open() {
    this.visible = true;
    this.setAttribute('visible', '');
    if (this._overlay) this._overlay.style.display = 'block';
    await this.refresh();
  }

  close() {
    this.visible = false;
    this.removeAttribute('visible');
    if (this._overlay) this._overlay.style.display = 'none';
  }

  async refresh() {
    this.loading = true;
    try {
      this.markers = await dataService.getMarkers() || [];
      // Initialize selected colors - all colors selected by default
      this._initializeColorSelection();
    } catch (err) {
      console.error('[PluginMarkers] Failed to load markers:', err);
      this.markers = [];
    } finally {
      this.loading = false;
    }
  }
  
  _initializeColorSelection() {
    const colors = this._getUniqueColors();
    const newSelection = {};
    colors.forEach(color => {
      // Keep existing selection state if color already exists
      newSelection[color] = this.selectedColors[color] !== undefined ? this.selectedColors[color] : true;
    });
    this.selectedColors = newSelection;
  }
  
  _getUniqueColors() {
    const colors = new Set();
    this.markers.forEach(m => {
      const color = m.marker?.color || '#2196F3';
      colors.add(color);
    });
    return Array.from(colors).sort();
  }
  
  _toggleColor(color) {
    this.selectedColors = {
      ...this.selectedColors,
      [color]: !this.selectedColors[color]
    };
    this._updateMarkers();
  }

  _updateMarkers() {
    if (!this.visible || !this._svgEl) return;
    
    // If SVG is not in DOM, we need to reinitialize
    if (!this._svgEl.isConnected) {
      this.firstUpdated();
      if (!this._svgEl?.isConnected) return;
    }

    // Clear existing markers (do this even if markers.length is 0)
    this._svgEl.innerHTML = '';
    
    // If no markers loaded yet, nothing more to do
    if (!this.markers.length) return;

    const board = document.querySelector('feature-board');
    if (!board) return;

    const boardRect = board.getBoundingClientRect();
    const boardOffset = getBoardOffset() || 0;
    const monthWidth = TIMELINE_CONFIG.monthWidth || 120;
    const months = getTimelineMonths();

    if (!months?.length) return;

    // Size SVG to viewport only
    this._svgEl.setAttribute('width', boardRect.width);
    this._svgEl.setAttribute('height', boardRect.height);
    this._svgEl.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);
    
    // Force style recalculation to ensure proper rendering
    this._svgEl.style.width = `${boardRect.width}px`;
    this._svgEl.style.height = `${boardRect.height}px`;

    // Filter markers by selected projects and teams
    const selectedProjects = (state.projects || []).filter(p => p.selected).map(p => p.id);
    const selectedTeams = (state.teams || []).filter(t => t.selected).map(t => t.id);
    
    let debugCount = 0;
    const filteredMarkers = this.markers.filter(markerEntry => {
      // When no teams or projects are selected, show nothing (same as feature board behavior)
      const hasProjectSelection = selectedProjects.length > 0;
      const hasTeamSelection = selectedTeams.length > 0;
      
      // If nothing is selected, hide all markers
      if (!hasProjectSelection || !hasTeamSelection) return false;
      
      // Check if marker's project matches selection
      const projectMatch = selectedProjects.includes(markerEntry.project);
      // If marker has no team_id, treat it as matching any team (team-agnostic marker)
      const teamMatch = !markerEntry.team_id || selectedTeams.includes(markerEntry.team_id);
      // Check color filter
      const markerColor = markerEntry.marker?.color || '#2196F3';
      const colorMatch = this.selectedColors[markerColor] !== false;
      
      // Must match all criteria
      return projectMatch && teamMatch && colorMatch;
    });

    // Deduplicate markers by plan_id + date + label
    const seen = new Set();
    const uniqueMarkers = filteredMarkers.filter(markerEntry => {
      const marker = markerEntry.marker;
      if (!marker?.date) return false;
      
      const key = `${markerEntry.plan_id}:${marker.date}:${marker.label || marker.title || ''}`;
      if (seen.has(key)) return false;
      
      seen.add(key);
      return true;
    });

    let renderedCount = 0;
    uniqueMarkers.forEach((markerEntry) => {
      const marker = markerEntry.marker;

      const x = this._calcX(new Date(marker.date), months, monthWidth, boardOffset);
      if (x === null) return;

      this._createMarker(x, marker.label || marker.title || 'Marker', marker.color || '#2196F3', markerEntry, boardRect.height);
      renderedCount++;
    });
  }

  _calcX(date, months, monthWidth, boardOffset) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();

    const monthIndex = months.findIndex(m => m.getFullYear() === year && m.getMonth() === month);
    if (monthIndex === -1) return null;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayRatio = (day - 1) / daysInMonth;
    
    return boardOffset + (monthIndex * monthWidth) + (dayRatio * monthWidth);
  }

  _createMarker(x, label, color, markerEntry, boardHeight, scrollTop) {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const timelineHeaderHeight = 60; // Height of timeline-lit header
    
    // Vertical dashed line extending from timeline header to bottom of visible area
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', 0);
    line.setAttribute('x2', x);
    line.setAttribute('y2', boardHeight);
    line.setAttribute('stroke', color);
    line.setAttribute('opacity', '0.4');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '4,4');
    line.style.pointerEvents = 'none';
    this._svgEl.appendChild(line);

    // Create compact tag at the top of timeline (not below it)
    const tagGroup = document.createElementNS(SVG_NS, 'g');
    tagGroup.setAttribute('class', 'marker-tag');
    tagGroup.style.cursor = 'pointer';
    tagGroup.style.pointerEvents = 'auto';
    
    // Tag dimensions
    const tagHeight = 18;
    const tagY = 5; // Position near top of timeline header
    const tagPadding = 6;
    const labelWidth = label.length * 5.5;
    const tagWidth = labelWidth + (tagPadding * 2);
    
    // Tag background with rounded corners
    const tagBg = document.createElementNS(SVG_NS, 'rect');
    tagBg.setAttribute('x', x - tagWidth / 2);
    tagBg.setAttribute('y', tagY);
    tagBg.setAttribute('width', tagWidth);
    tagBg.setAttribute('height', tagHeight);
    tagBg.setAttribute('fill', color);
    tagBg.setAttribute('rx', '3');
    tagBg.setAttribute('opacity', '0.9');
    tagGroup.appendChild(tagBg);
    
    // Tag label
    const tagText = document.createElementNS(SVG_NS, 'text');
    tagText.setAttribute('x', x);
    tagText.setAttribute('y', tagY + 13);
    tagText.setAttribute('fill', 'white');
    tagText.setAttribute('font-size', '10');
    tagText.setAttribute('font-weight', '600');
    tagText.setAttribute('text-anchor', 'middle');
    tagText.textContent = label;
    tagGroup.appendChild(tagText);
    
    // Tooltip
    const title = document.createElementNS(SVG_NS, 'title');
    const tooltipParts = [
      label,
      markerEntry.plan_name ? `Plan: ${markerEntry.plan_name}` : '',
      markerEntry.marker.date ? `Date: ${markerEntry.marker.date}` : ''
    ].filter(Boolean);
    title.textContent = tooltipParts.join('\n');
    tagGroup.appendChild(title);
    
    this._svgEl.appendChild(tagGroup);
  }
}

customElements.define('plugin-markers', PluginMarkersComponent);
export default PluginMarkersComponent;
