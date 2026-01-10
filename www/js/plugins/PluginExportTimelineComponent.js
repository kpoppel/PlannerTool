import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { AppEvents } from '../core/EventRegistry.js';
import { pluginManager } from '../core/PluginManager.js';
import { exportTimelineToPng } from './export/TimelineExportRenderer.js';

export class PluginExportTimeline extends LitElement {
  static properties = { 
    visible: { type: Boolean },
    exporting: { type: Boolean },
    includeAnnotations: { type: Boolean },
    annotationsAvailable: { type: Boolean }
  };
  
  constructor(){ 
    super(); 
    this.visible = false;
    this.exporting = false;
    this.includeAnnotations = true;
    this.annotationsAvailable = false;
    this._annotationState = null;
  }

  connectedCallback() {
    super.connectedCallback();
    // Capture scroll position on any mousedown to preserve it before click handlers run
    // IMPORTANT: Horizontal scroll is on timelineSection, vertical on featureBoard
    this._mouseDownHandler = () => {
      const timelineSection = document.getElementById('timelineSection');
      const featureBoard = document.querySelector('feature-board');
      if (timelineSection && featureBoard) {
        this._lastKnownScrollLeft = timelineSection.scrollLeft;
        this._lastKnownScrollTop = featureBoard.scrollTop;
      }
    };
    document.addEventListener('mousedown', this._mouseDownHandler);
  }
  
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._mouseDownHandler) {
      document.removeEventListener('mousedown', this._mouseDownHandler);
    }
  }

  static styles = css`
    :host { 
      display: block; 
      position: absolute; 
      left: 0; 
      top: 0; 
      right: 0; 
      bottom: 0; 
      z-index: 60; 
      box-sizing: border-box;
      pointer-events: none;
    }
    
    :host([visible]) {
      pointer-events: auto;
    }
    
    .panel { 
      width: 520px; 
      max-width: 95%; 
      background: #fff; 
      box-shadow: 0 8px 30px rgba(0,0,0,0.2); 
      padding: 20px; 
      margin: 40px auto; 
      border-radius: 8px;
      pointer-events: auto;
    }
    
    .panel h3 {
      margin: 0 0 16px 0;
      font-size: 18px;
      color: #333;
    }
    
    .section {
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid #eee;
    }
    
    .section:last-child {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }
    
    .section-title {
      font-size: 13px;
      font-weight: 600;
      color: #666;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .row { 
      display: flex; 
      gap: 8px; 
      align-items: center;
      flex-wrap: wrap;
    }
    
    button {
      padding: 8px 16px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    
    button:hover {
      background: #f5f5f5;
      border-color: #ccc;
    }
    
    button:active {
      background: #eee;
    }
    
    button.primary {
      background: #2196F3;
      border-color: #1976D2;
      color: white;
    }
    
    button.primary:hover {
      background: #1976D2;
    }
    
    button.primary:disabled {
      background: #90CAF9;
      border-color: #90CAF9;
      cursor: not-allowed;
    }
    
    .btn-icon {
      font-size: 16px;
      line-height: 1;
    }
    
    .info-text {
      font-size: 12px;
      color: #666;
      margin-top: 8px;
    }
    
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }
    
    .checkbox-row input[type="checkbox"] {
      width: 16px;
      height: 16px;
      cursor: pointer;
    }
    
    .checkbox-row label {
      font-size: 13px;
      color: #333;
      cursor: pointer;
    }
  `;

  render(){
    const annotationCount = this._getAnnotationCount();
    const showAnnotationOption = this.annotationsAvailable && annotationCount > 0;
    
    // Main export panel
    return html`
      <div class="panel" role="dialog" aria-modal="true">
        <h3>Export Timeline</h3>
        
        <div class="section">
          <div class="section-title">Image Export</div>
          <div class="row">
            <button class="primary" @click="${this._exportPng}" ?disabled="${this.exporting}">
              <span class="btn-icon">📷</span>
              ${this.exporting ? 'Exporting...' : 'Export PNG'}
            </button>
          </div>
          ${showAnnotationOption ? html`
            <div class="checkbox-row">
              <input 
                type="checkbox" 
                id="includeAnnotations"
                .checked="${this.includeAnnotations}"
                @change="${this._toggleIncludeAnnotations}"
              />
              <label for="includeAnnotations">Include annotations (${annotationCount})</label>
            </div>
          ` : ''}
          <div class="info-text">
            PNG export captures the visible timeline viewport with full vertical board content.
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Data Export</div>
          <div class="row">
            <button @click="${this._exportJson}">
              <span class="btn-icon">📋</span>
              Export JSON
            </button>
            <button @click="${this._exportCsv}">
              <span class="btn-icon">📊</span>
              Export CSV
            </button>
          </div>
          <div class="info-text">Export timeline data and capacity information for external processing.</div>
        </div>
        
        <!-- Closing is handled by the plugin toggle in the toolbar; removed internal Close button -->
      </div>
    `;
  }

  firstUpdated(){
    bus.on(AppEvents.READY, ()=>{ /* ensure state available */ });
  }

  /**
   * Check if the Annotations plugin is available and get its state
   */
  _checkAnnotationsPlugin() {
    // Check if the annotations plugin is registered (doesn't need to be active)
    const annotationsPlugin = pluginManager.get('plugin-annotations');
    this.annotationsAvailable = !!annotationsPlugin;
    
    if (this.annotationsAvailable) {
      // Dynamically import and get the annotation state
      import('./annotations/index.js').then(module => {
        this._annotationState = module.getAnnotationState();
        // Subscribe to changes
        this._annotationState.subscribe(() => {
          this.requestUpdate();
        });
        this.requestUpdate();
      });
    } else {
      this._annotationState = null;
    }
  }
  
  _getAnnotationCount() {
    return this._annotationState ? this._annotationState.annotations.length : 0;
  }

  open(mode){ 
    // Use scroll position captured on mousedown (before any DOM changes)
    // IMPORTANT: Horizontal scroll is on timelineSection, vertical on featureBoard
    const timelineSection = document.getElementById('timelineSection');
    const featureBoard = document.querySelector('feature-board');
    this._capturedScrollLeft = this._lastKnownScrollLeft ?? timelineSection?.scrollLeft ?? 0;
    this._capturedScrollTop = this._lastKnownScrollTop ?? featureBoard?.scrollTop ?? 0;
    
    // Check annotations plugin status when opening
    this._checkAnnotationsPlugin();
    
    this.style.display = 'block'; 
    this.visible = true;
    this.setAttribute('visible', '');
  }
  
  close(){ 
    this.style.display = 'none'; 
    this.visible = false;
    this.removeAttribute('visible');
  }
  
  _toggleIncludeAnnotations(e) {
    this.includeAnnotations = e.target.checked;
  }

  // --- PNG Export ---
  
  async _exportPng() {
    this.exporting = true;
    try {
      // Only include annotations if the plugin is available and checkbox is checked
      const includeAnnotations = this.annotationsAvailable && this.includeAnnotations;
      // Pass captured scroll position from when dialog was opened
      await exportTimelineToPng({ 
        includeAnnotations,
        scrollLeft: this._capturedScrollLeft,
        scrollTop: this._capturedScrollTop
      });
    } catch (e) {
      console.error('[PluginExportTimeline] PNG export failed:', e);
      alert('Export failed. Check console for details.');
    } finally {
      this.exporting = false;
    }
  }

  _collectTimelineData(){
    // Collect a sensible snapshot from global state used by timeline components
    const out = {
      generatedAt: (new Date()).toISOString(),
      projects: state.projects || [],
      teams: state.teams || [],
      capacityDates: state.capacityDates || [],
      projectDailyCapacity: state.projectDailyCapacity || [],
      teamDailyCapacity: state.teamDailyCapacity || [],
      features: state.features || [],
      view: {
        capacityMode: state._viewService ? state._viewService.capacityViewMode : undefined,
        showEpics: state._viewService ? !!state._viewService.showEpics : undefined,
        showFeatures: state._viewService ? !!state._viewService.showFeatures : undefined
      }
    };
    return out;
  }

  _download(filename, dataStr, mime='application/json'){
    const blob = new Blob([dataStr], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  }

  _exportJson(){
    const data = this._collectTimelineData();
    this._download('timeline-export.json', JSON.stringify(data, null, 2), 'application/json');
  }

  _exportCsv(){
    const data = this._collectTimelineData();
    // Simple CSV: date, projectId, projectName, value% for each project per date
    const dates = data.capacityDates || [];
    const projects = data.projects || [];
    const rows = [];
    const header = ['date'];
    projects.forEach(p=> header.push(`proj:${p.id}`));
    rows.push(header.join(','));
    const pd = data.projectDailyCapacity || [];
    for(let i=0;i<dates.length;i++){
      const cells = [dates[i]];
      const rowArr = pd[i] || [];
      for(let j=0;j<projects.length;j++){
        cells.push(String(rowArr[j] || 0));
      }
      rows.push(cells.join(','));
    }
    this._download('timeline-export.csv', rows.join('\n'), 'text/csv');
  }
}

customElements.define('plugin-export-timeline', PluginExportTimeline);

export default PluginExportTimeline;
