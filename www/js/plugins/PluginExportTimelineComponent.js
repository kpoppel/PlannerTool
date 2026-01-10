import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { AppEvents } from '../core/EventRegistry.js';
import { exportTimelineToPng } from './export/TimelineExportRenderer.js';
import { TOOLS, TOOL_DEFINITIONS, getAnnotationState } from './export/AnnotationTools.js';
import { ANNOTATION_COLORS } from './export/ExportUtils.js';
import './export/AnnotationOverlay.js';

export class PluginExportTimeline extends LitElement {
  static properties = { 
    visible: { type: Boolean },
    annotateMode: { type: Boolean },
    currentTool: { type: String },
    exporting: { type: Boolean }
  };
  
  constructor(){ 
    super(); 
    this.visible = false;
    this.annotateMode = false;
    this.currentTool = TOOLS.SELECT;
    this.exporting = false;
    this._annotationState = getAnnotationState();
    this._overlay = null;
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
    
    button.active {
      background: #E3F2FD;
      border-color: #2196F3;
      color: #1976D2;
    }
    
    button.danger {
      color: #d32f2f;
      border-color: #ffcdd2;
    }
    
    button.danger:hover {
      background: #ffebee;
    }
    
    .tool-btn {
      width: 36px;
      height: 36px;
      padding: 0;
      justify-content: center;
      font-size: 18px;
    }
    
    .tool-btn .tool-icon {
      font-size: 18px;
      line-height: 1;
    }
    
    .btn-icon {
      font-size: 16px;
      line-height: 1;
    }
    
    .color-swatch {
      width: 24px;
      height: 24px;
      border-radius: 4px;
      border: 2px solid transparent;
      cursor: pointer;
      transition: transform 0.1s ease;
    }
    
    .color-swatch:hover {
      transform: scale(1.1);
    }
    
    .color-swatch.selected {
      border-color: #333;
    }
    
    .info-text {
      font-size: 12px;
      color: #666;
      margin-top: 8px;
    }
    
    .status-text {
      font-size: 13px;
      color: #666;
      padding: 8px 12px;
      background: #f5f5f5;
      border-radius: 4px;
    }
    
    .annotation-count {
      font-size: 11px;
      background: #E3F2FD;
      color: #1976D2;
      padding: 2px 6px;
      border-radius: 10px;
      margin-left: 4px;
    }

    /* Floating toolbar for annotation mode */
    .floating-toolbar {
      position: fixed;
      top: 80px;
      right: 20px;
      background: white;
      padding: 12px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      z-index: 100;
      pointer-events: auto;
    }
    
    .floating-toolbar .row {
      margin-bottom: 8px;
    }
    
    .floating-toolbar .row:last-child {
      margin-bottom: 0;
    }
  `;

  render(){
    const annotationCount = this._annotationState.annotations.length;
    
    // If in annotate mode, show floating toolbar instead of panel
    if (this.annotateMode) {
      return html`
        <div class="floating-toolbar">
          <div class="row">
            ${TOOL_DEFINITIONS.map(tool => html`
              <button 
                class="tool-btn ${this.currentTool === tool.id ? 'active' : ''}"
                title="${tool.name}: ${tool.description}"
                @click="${() => this._setTool(tool.id)}"
              >
                <span class="tool-icon">${tool.icon}</span>
              </button>
            `)}
          </div>
          <div class="row">
            ${ANNOTATION_COLORS.palette.map(color => html`
              <div
                class="color-swatch ${this._isColorSelected(color) ? 'selected' : ''}"
                style="background: ${color.fill}; border-color: ${this._isColorSelected(color) ? color.stroke : 'transparent'}"
                title="${color.name}"
                @click="${() => this._setColor(color)}"
              ></div>
            `)}
          </div>
          <div class="row" style="margin-top: 12px;">
            <button class="primary" @click="${this._exportPng}" ?disabled="${this.exporting}">
              ${this.exporting ? 'Exporting...' : '📷 Export PNG'}
            </button>
            <button @click="${this._exitAnnotateMode}">Done</button>
            ${annotationCount > 0 ? html`
              <button class="danger" @click="${this._clearAnnotations}" title="Clear all annotations">
                🗑
              </button>
            ` : ''}
          </div>
        </div>
        ${this._renderOverlay()}
      `;
    }
    
    // Main export panel
    return html`
      <div class="panel" role="dialog" aria-modal="true">
        <h3>Export Timeline</h3>
        
        <div class="section">
          <div class="section-title">Image Export</div>
          <div class="row">
            <button class="primary" @click="${this._startAnnotateMode}">
              <span class="btn-icon">✏️</span>
              Annotate & Export PNG
              ${annotationCount > 0 ? html`<span class="annotation-count">${annotationCount}</span>` : ''}
            </button>
            <button @click="${this._exportPngDirect}" ?disabled="${this.exporting}">
              <span class="btn-icon">📷</span>
              ${this.exporting ? 'Exporting...' : 'Quick Export PNG'}
            </button>
          </div>
          <div class="info-text">
            PNG export captures the visible timeline viewport with full vertical board content.
            ${annotationCount > 0 ? html`<br><strong>${annotationCount} annotation(s)</strong> will be included.` : ''}
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
        
        <div class="section">
          <div class="row" style="justify-content: flex-end;">
            <button @click="${this.close}">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderOverlay() {
    return html`
      <annotation-overlay 
        id="annotationOverlay"
        ?active="${this.annotateMode}"
      ></annotation-overlay>
    `;
  }

  firstUpdated(){
    bus.on(AppEvents.READY, ()=>{ /* ensure state available */ });
    
    // Subscribe to annotation state changes
    this._annotationState.subscribe(() => {
      this.requestUpdate();
    });
  }

  updated(changedProps) {
    if (changedProps.has('annotateMode')) {
      this._updateOverlay();
    }
  }

  _updateOverlay() {
    // Get or create overlay
    this._overlay = this.shadowRoot?.querySelector('#annotationOverlay');
    
    if (this._overlay) {
      if (this.annotateMode) {
        this._overlay.show();
      } else {
        this._overlay.hide();
      }
    }
  }

  open(mode){ 
    this.style.display = 'block'; 
    this.visible = true;
    this.setAttribute('visible', '');
  }
  
  close(){ 
    this.style.display = 'none'; 
    this.visible = false;
    this.annotateMode = false;
    this.removeAttribute('visible');
  }

  // --- Annotation Mode ---
  
  _startAnnotateMode() {
    this.annotateMode = true;
    this.currentTool = TOOLS.SELECT;
    this._annotationState.setTool(TOOLS.SELECT);
  }
  
  _exitAnnotateMode() {
    this.annotateMode = false;
  }
  
  _setTool(tool) {
    this.currentTool = tool;
    this._annotationState.setTool(tool);
    if (this._overlay) {
      this._overlay.setTool(tool);
    }
  }
  
  _setColor(color) {
    this._annotationState.setColor(color);
    this.requestUpdate();
  }
  
  _isColorSelected(color) {
    const current = this._annotationState.currentColor;
    return current && current.fill === color.fill;
  }
  
  _clearAnnotations() {
    if (confirm('Clear all annotations? This cannot be undone.')) {
      this._annotationState.clear();
      if (this._overlay) {
        this._overlay.clearAll();
      }
    }
  }

  // --- PNG Export ---
  
  async _exportPng() {
    this.exporting = true;
    try {
      await exportTimelineToPng({ includeAnnotations: true });
    } catch (e) {
      console.error('[PluginExportTimeline] PNG export failed:', e);
      alert('Export failed. Check console for details.');
    } finally {
      this.exporting = false;
    }
  }
  
  async _exportPngDirect() {
    this.exporting = true;
    try {
      await exportTimelineToPng({ includeAnnotations: true });
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
