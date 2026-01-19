import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { AppEvents } from '../core/EventRegistry.js';

export class SearchTool extends LitElement {
  static properties = {
    visible: { type: Boolean },
    query: { type: String },
    results: { type: Array },
    highlightIndex: { type: Number }
  };

  constructor(){
    super();
    this.visible = false;
    this.query = '';
    this.results = [];
    this._debounce = null;
    this.highlightIndex = -1;
  }

  static styles = css`
    :host { position: absolute; z-index: 220; right: 16px; top: 56px; display:block; }
    .panel { width: 320px; max-width: 95%; background: var(--color-panel-bg, #fff); box-shadow: 0 8px 30px rgba(0,0,0,0.2); padding: 8px; border-radius:8px; }
    .search-input { width:100%; padding:8px 10px; border-radius:6px; border:1px solid #ddd; box-sizing:border-box; font-size:14px; }
    .results { margin-top:8px; max-height: 320px; overflow:auto; }
    .result { padding:8px; border-radius:6px; cursor:pointer; display:flex; gap:8px; align-items:center; }
    .result[aria-selected="true"]{ background: #eef6ff; }
    .result .title { font-weight:600; font-size:0.95rem; }
    .result .meta { font-size:0.85rem; color:#666; margin-left:auto; }
    .search-highlight { outline: 3px solid rgba(66,133,244,0.35); transition: outline 0.25s ease; }
  `;

  render(){
    return html`
      <div class="panel" role="dialog" aria-label="Search Features">
        <input class="search-input" type="search" placeholder="Search by id or title..." @input="${this._onInput}" @keydown="${this._onKeyDown}" .value="${this.query}" />
        <div class="results" role="list">
          ${this.results.map((r, idx) => html`
            <div class="result" role="option" aria-selected="${this.highlightIndex===idx}" @click="${()=>this._onSelect(r)}" @mouseover="${()=>this._setHighlight(idx)}">
              <div class="title">${r.title || ''}</div>
              <div class="meta">${r.id}</div>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  connectedCallback(){
    super.connectedCallback();
    this._onAppReady = ()=>{};
    bus.on(AppEvents.READY, this._onAppReady);
    document.addEventListener('keydown', this._globalKeyDown = (e)=>{
      if(this.visible && e.key === 'Escape') { e.stopPropagation(); this.close(); }
    });
  }

  disconnectedCallback(){
    super.disconnectedCallback();
    bus.off(AppEvents.READY, this._onAppReady);
    document.removeEventListener('keydown', this._globalKeyDown);
  }

  open(){
    if(!this.parentNode) document.body.appendChild(this);
    this.visible = true;
    this.style.display = 'block';
    this.setAttribute('visible','');
    requestAnimationFrame(()=> this.focusInput());
  }

  close(){
    this.visible = false;
    this.style.display = 'none';
    this.removeAttribute('visible');
    if(this.parentNode) this.parentNode.removeChild(this);
  }

  focusInput(){
    const inp = this.shadowRoot.querySelector('.search-input');
    if(inp){ inp.focus(); inp.select(); }
  }

  _onInput(e){
    this.query = e.target.value || '';
    if(this._debounce) clearTimeout(this._debounce);
    this._debounce = setTimeout(()=> this._performSearch(), 180);
  }

  _onKeyDown(e){
    if(e.key === 'ArrowDown'){ e.preventDefault(); this._moveHighlight(1); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); this._moveHighlight(-1); }
    else if(e.key === 'Enter'){ e.preventDefault(); const r = this.results[this.highlightIndex] || this.results[0]; if(r) this._onSelect(r); }
    else if(e.key === 'Escape'){ e.preventDefault(); this.close(); }
  }

  _moveHighlight(delta){
    if(!this.results || this.results.length===0) return;
    let idx = this.highlightIndex;
    if(idx === -1) idx = 0;
    idx = Math.max(0, Math.min(this.results.length-1, idx + delta));
    this.highlightIndex = idx;
    const el = this.shadowRoot.querySelectorAll('.result')[idx];
    if(el) el.scrollIntoView({ block: 'nearest' });
  }

  _setHighlight(idx){ this.highlightIndex = idx; }

  _performSearch(){
    const q = (this.query || '').trim();
    if(!q){ this.results = []; this.highlightIndex = -1; this.requestUpdate(); return; }

    const all = state.getEffectiveFeatures() || [];
    const qLower = q.toLowerCase();

    const idMatches = [];
    const titleMatches = [];
    for(const f of all){
      const fid = String(f.id || '');
      const title = String(f.title || f.name || '');
      if(fid.indexOf(q) !== -1){ idMatches.push({ id: fid, title }); continue; }
      if(title.toLowerCase().indexOf(qLower) !== -1){ titleMatches.push({ id: fid, title }); }
    }

    this.results = [...idMatches, ...titleMatches].slice(0, 100);
    this.highlightIndex = this.results.length>0?0:-1;
    this.requestUpdate();
  }

  _onSelect(item){
    try{
      const board = document.querySelector('feature-board');
      if(board && typeof board.centerFeatureById === 'function'){
        board.centerFeatureById(item.id);
      } else {
        const timeline = document.getElementById('timelineSection');
        const fb = document.querySelector('feature-board');
        const card = document.querySelector(`feature-card-lit[data-feature-id="${item.id}"]`) || document.querySelector(`feature-card-lit[featureid="${item.id}"]`);
        if(card && timeline && fb){
          const targetX = card.offsetLeft - (timeline.clientWidth / 2) + (card.clientWidth / 2);
          const targetY = card.offsetTop - (fb.clientHeight / 2) + (card.clientHeight / 2);
          timeline.scrollTo({ left: targetX, behavior: 'smooth' });
          fb.scrollTo({ top: targetY, behavior: 'smooth' });
        }
      }
    }catch(e){ console.warn('SearchTool: center failed', e); }

    const node = document.querySelector(`feature-card-lit[data-feature-id="${item.id}"]`);
    if(node){ node.classList.add('search-highlight'); setTimeout(()=> node.classList.remove('search-highlight'), 900); }

    this.close();
  }
}

customElements.define('search-tool', SearchTool);
