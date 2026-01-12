import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { AppEvents } from '../core/EventRegistry.js';
import { pluginManager } from '../core/PluginManager.js';
import { exportTimelineToPng, getExportRenderer } from './export/TimelineExportRenderer.js';
import { copyPngBlobToClipboard } from './export/ExportUtils.js';

export class PluginExportTimeline extends LitElement {
  static properties = { 
    visible: { type: Boolean },
    exporting: { type: Boolean },
    includeAnnotations: { type: Boolean },
    annotationsAvailable: { type: Boolean },
    includeDependencies: { type: Boolean }
  };
  
  constructor(){ 
    super(); 
    this.visible = false;
    this.exporting = false;
    this.includeAnnotations = true;
    this.includeDependencies = true;
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
      pointer-events: none; /* let clicks pass through by default */
    }
    
    /* Keep host non-interactive; only the panel receives pointer events */
    :host([visible]) {
      pointer-events: none;
    }
    
    .panel { 
      width: 200px; 
      max-width: 95%; 
      background: #fff; 
      box-shadow: 0 8px 30px rgba(0,0,0,0.2); 
      padding: 16px; 
      margin: 0; 
      border-radius: 8px;
      pointer-events: auto; /* panel should handle pointer events */
      position: fixed;
      top: 56px;
      right: 16px;
      z-index: 200;
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
      align-items: stretch;
      flex-wrap: nowrap;
      flex-direction: column;
    }

    /* Chip-style toggles (matches sidebar chips) */
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 16px;
      border: 1px solid rgba(0,0,0,0.06);
      color: #333;
      background: #f3f4f6; /* pale grey when not active */
      cursor: pointer;
      font-size: 13px;
      user-select: none;
      justify-content: flex-start;
      width: 100%;
    }
      /* Active state: soft amber fill with dark text (calm) */
      .chip.active { background: var(--chip-active-bg, #FFECB3); color: var(--chip-active-text, #5A3A00); border-color: var(--chip-active-bg, #FFECB3); }
      .chip .chip-badge { background: rgba(0,0,0,0.06); color: inherit; padding: 2px 8px; border-radius: 12px; font-weight:600; font-size:12px; }
      /* Force badge to the right regardless of DOM order */
      .chip > .chip-badge { order: 2; margin-left: auto; }
      .chip > span:not(.chip-badge) { order: 1; }
      /* Check indicator shown only when active */
      .chip .chip-check { display: none; font-size: 12px; margin-right: 4px; color: var(--chip-active-text, #5A3A00); }
      .chip.active .chip-check { display: inline-flex; }
    
    button {
      padding: 6px 12px;
      border-radius: 16px;
      background: var(--color-sidebar-bg, rgba(35, 52, 77, 1));
      border: 1px solid rgba(0,0,0,0.06);
      color: var(--color-sidebar-text, #ffffff);
      cursor: pointer;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s ease;
      justify-content: flex-start;
    }
    
    button:hover {
      filter: brightness(1.05);
    }
    
    button:active {
      background: #eee;
    }
    
    button.primary {
      background: white;
      border-color: #fff;
      color: #23344d;
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
      width: 22px; display:inline-flex; align-items:center; justify-content:center;
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
            <button class="button" @click="${this._exportPng}" ?disabled="${this.exporting}">
              <span class="btn-icon">📷</span>
              ${this.exporting ? 'Exporting...' : 'Export PNG'}
            </button>
            <button @click="${this._downloadSvg}" ?disabled="${this.exporting}">
              <span class="btn-icon">🖼️</span>
              Export SVG
            </button>
            <button @click="${this._copyPng}" ?disabled="${this.exporting}">
              <span class="btn-icon">📋</span>
              Copy PNG
            </button>

            <div class="info-text">
              Include:
            </div>
            ${showAnnotationOption ? html`
              <button
                class="chip ${this.includeAnnotations ? 'active' : ''}"
                @click="${this._toggleIncludeAnnotations}"
                aria-pressed="${this.includeAnnotations}"
                title="Toggle annotations"
              >
              <span class="chip-badge">${this.includeAnnotations ? 'On' : 'Off'}</span>
                <span>Annotations (${annotationCount})</span>
              </button>
            ` : ''}

            <button
              class="chip ${this.includeDependencies ? 'active' : ''}"
              @click="${this._toggleIncludeDependencies}"
              aria-pressed="${this.includeDependencies}"
              title="Toggle dependency relations"
            >
              <span class="chip-badge">${this.includeDependencies ? 'On' : 'Off'}</span>
              <span>Dependencies</span>
            </button>
          </div>
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
    // Remove element from DOM so lifecycle matches other plugin components
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  
  _toggleIncludeAnnotations(e) {
    if (e && e.target && typeof e.target.checked === 'boolean') {
      this.includeAnnotations = e.target.checked;
    } else {
      this.includeAnnotations = !this.includeAnnotations;
    }
    this.requestUpdate();
  }

  _toggleIncludeDependencies(e) {
    if (e && e.target && typeof e.target.checked === 'boolean') {
      this.includeDependencies = e.target.checked;
    } else {
      this.includeDependencies = !this.includeDependencies;
    }
    this.requestUpdate();
  }

  // Small app-modal wrapper to show messages
  async _showAppMessage(title, message, options = {}) {
    // Use the auto-close modal component to show a brief message
    await import('../components/AutoCloseMessageModal.js');
    // Reuse a single app-wide auto-close modal instance
    let modal = document.getElementById('app-message-modal');
    if (!modal) {
      modal = document.createElement('modal-autoclose');
      modal.id = 'app-message-modal';
      document.body.appendChild(modal);
    }

    // Update message and duration before opening; if already open, it will restart timer
    modal.message = `${title ? title + '\n' : ''}${message || ''}`;
    const duration = typeof options.duration === 'number' ? options.duration : (options.persistent ? 0 : 2000);
    modal.duration = duration;

    // Open after insertion so LitElement lifecycle notices change
    requestAnimationFrame(() => { modal.open = true; });

    // Return a promise that resolves when this modal-close event fires for this show
    return new Promise(resolve => {
      const onClose = (e) => {
        modal.removeEventListener('modal-close', onClose);
        resolve(e?.detail ?? null);
      };
      modal.addEventListener('modal-close', onClose, { once: true });
    });
  }

  // --- PNG Export ---
  
  async _exportPng() {
    this.exporting = true;
    try {
      // Only include annotations if the plugin is available and checkbox is checked
      const includeAnnotations = this.annotationsAvailable && this.includeAnnotations;
      // Read current viewport scroll positions at the moment of export
      const timelineSection = document.getElementById('timelineSection');
      const featureBoard = document.querySelector('feature-board');
      const currentScrollLeft = timelineSection ? timelineSection.scrollLeft : (this._capturedScrollLeft || 0);
      const currentScrollTop = featureBoard ? featureBoard.scrollTop : (this._capturedScrollTop || 0);

      await exportTimelineToPng({
        includeAnnotations,
        includeDependencies: this.includeDependencies,
        scrollLeft: currentScrollLeft,
        scrollTop: currentScrollTop
      });
    } catch (e) {
      console.error('[PluginExportTimeline] PNG export failed:', e);
      await this._showAppMessage(
        'Export Failed',
        'PNG export failed. This can happen when many items are visible (browser memory limits). Try showing fewer items and export again. See console for details.',
        { persistent: true }
      );
    } finally {
      this.exporting = false;
    }
  }



  async _downloadSvg() {
    this.exporting = true;
    try {
      const includeAnnotations = this.annotationsAvailable && this.includeAnnotations;
      const timelineSection = document.getElementById('timelineSection');
      const featureBoard = document.querySelector('feature-board');
      const currentScrollLeft = timelineSection ? timelineSection.scrollLeft : (this._capturedScrollLeft || 0);
      const currentScrollTop = featureBoard ? featureBoard.scrollTop : (this._capturedScrollTop || 0);

      const renderer = getExportRenderer();
      const svg = await renderer.getExportSvg({ includeAnnotations, includeDependencies: this.includeDependencies, scrollLeft: currentScrollLeft, scrollTop: currentScrollTop });

      // Serialize and download
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svg);
      const filename = 'timeline-export.svg';
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[PluginExportTimeline] Download SVG failed:', e);
      await this._showAppMessage(
        'Download SVG Failed',
        'Download SVG failed. If the board contains many items try narrowing the view and retry. See console for details.',
        { persistent: true }
      );
    } finally {
      this.exporting = false;
    }
  }

  async _copyPng() {
    this.exporting = true;
    try {
      const includeAnnotations = this.annotationsAvailable && this.includeAnnotations;
      const timelineSection = document.getElementById('timelineSection');
      const featureBoard = document.querySelector('feature-board');
      const currentScrollLeft = timelineSection ? timelineSection.scrollLeft : (this._capturedScrollLeft || 0);
      const currentScrollTop = featureBoard ? featureBoard.scrollTop : (this._capturedScrollTop || 0);

      const renderer = getExportRenderer();
      const blob = await renderer.exportToPngBlob({ includeAnnotations, includeDependencies: this.includeDependencies, scrollLeft: currentScrollLeft, scrollTop: currentScrollTop });

      await copyPngBlobToClipboard(blob);
      await this._showAppMessage('Copied', 'PNG image copied to clipboard', { duration: 3000 });
    } catch (e) {
      console.error('[PluginExportTimeline] Copy PNG failed:', e);
      await this._showAppMessage(
        'Copy PNG Failed',
        'Copy PNG failed. Your browser may not support copying images to clipboard, or the export may have been too large. Try showing fewer items and try again.',
        { persistent: true }
      );
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
        ,showDependencies: state._viewService ? !!state._viewService.showDependencies : undefined
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
