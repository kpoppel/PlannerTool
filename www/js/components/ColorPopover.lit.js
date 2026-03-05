import { LitElement, html, css } from '../vendor/lit.js';
import { dataService } from '../services/dataService.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { ProjectEvents, TeamEvents, ColorEvents } from '../core/EventRegistry.js';

export class ColorPopoverLit extends LitElement {
  static properties = {
    open: { type: Boolean },
    entityType: { type: String },
    entityId: { type: String },
    left: { type: Number },
    top: { type: Number },
    palette: { type: Array }
  };

  static styles = css`
    :host { position: fixed; display: block; z-index: 2000; }
    .color-popover {
      display: grid;
      grid-template-columns: repeat(4, 28px);
      gap:4px;
      padding:4px;
      background: rgb(55, 85, 130);
      border:1px solid rgb(35, 52, 77);
      box-shadow: 0 6px 18px rgba(0,0,0,0.12);
      border-radius:6px;
    }
    .color-swatch { width:28px; height:28px; border-radius:4px; border:0px solid #ddd; cursor:pointer; }
  `;

  

  constructor(){
    super();
    this.open = false;
    this.entityType = '';
    this.entityId = '';
    this.left = 0;
    this.top = 0;
    this.palette = [];
    this._onDocDown = this._onDocDown.bind(this);
    this._onPaletteUpdated = this._onPaletteUpdated.bind(this);
  }

  // Ensure a single instance exists in document.body. Returns the instance.
  // Ensure a single instance exists in document.body. Optionally accept a
  // `palette` argument to seed the component palette on creation.
  static async ensureInstance(palette){
    let el = document.querySelector('color-popover');
    if(!el){
      el = document.createElement('color-popover');
      document.body.appendChild(el);
      if(el.updateComplete) await el.updateComplete;
    }
    if(palette && typeof el.setPalette === 'function') el.setPalette(palette);
    return el;
  }

  // Use the default Lit render root (shadow DOM) so this behaves as a proper
  // Lit component with encapsulated styles.

  connectedCallback(){
    super.connectedCallback();
    document.addEventListener('mousedown', this._onDocDown);
    this._onKeyDown = (e)=>{ if(e.key==='Escape') this.close(); };
    document.addEventListener('keydown', this._onKeyDown);
    // Listen for palette updates via a DOM event (detail may be palette array or { palette })
    document.addEventListener('palette:updated', this._onPaletteUpdated);
  }
  disconnectedCallback(){
    document.removeEventListener('mousedown', this._onDocDown);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('palette:updated', this._onPaletteUpdated);
    super.disconnectedCallback();
  }

  _onPaletteUpdated(e){
    const p = e && e.detail ? (e.detail.palette || e.detail) : null;
    if(p && Array.isArray(p)) this.setPalette(p);
  }

  // Allow programmatic palette updates
  setPalette(p){ this.palette = Array.isArray(p) ? p.slice() : []; this.requestUpdate(); }

  _onDocDown(e){ if(!this.open) return; const path = (e.composedPath && e.composedPath()) || []; if(!path.includes(this)) this.close(); }

  async applyColor(color){
    if(!this.entityId || !this.entityType) return;
    try{
      if(this.entityType==='project'){
        const p = state.projects.find(x=>x.id===this.entityId); if(!p) return; p.color = color; await dataService.updateProjectColor(this.entityId, color); bus.emit(ProjectEvents.CHANGED, state.projects);
      } else if(this.entityType==='team'){
        const t = state.teams.find(x=>x.id===this.entityId); if(!t) return; t.color = color; await dataService.updateTeamColor(this.entityId, color); bus.emit(TeamEvents.CHANGED, state.teams);
      }
      bus.emit(ColorEvents.CHANGED, { entityType: this.entityType, id: this.entityId, color });
    }catch(e){ console.error('ColorPopover.applyColor', e); }
    this.close();
  }

  openFor(entityType, id, rect){
    this.entityType = entityType;
    this.entityId = id;
    // Position host relative to viewport using fixed positioning
    const left = rect.left + window.scrollX;
    const top = rect.bottom + window.scrollY + 4;
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;
    this.open = true;
    this.requestUpdate();
  }
  close(){ this.open=false; this.requestUpdate(); }

  render(){
    // Render the container always (legacy tests expect `.color-popover` to exist)
    // but toggle its `display` style between 'grid' and 'none' for show/hide.
    const display = this.open ? 'grid' : 'none';
    const palette = Array.isArray(this.palette) && this.palette.length ? this.palette : [];
    return html`<div class="color-popover" style="display:${display};">${palette.map(c=> html`<button class="color-swatch" data-color="${c}" style="background:${c}" @click=${()=>this.applyColor(c)} aria-label="${c}"></button>`)} </div>`;
  }
}

customElements.define('color-popover', ColorPopoverLit);
