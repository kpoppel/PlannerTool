import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';

/*
 * HelpModal: lightweight two-column help viewer
 * - loads `/static/docs/index.json` for list of docs
 * - fetches selected markdown under `/static/docs/` and renders to HTML
 * - supports title search, simple toc, images (served from /static/docs/)
 * This keeps the implementation dependency-free and easy to maintain.
 */
export class HelpModal extends LitElement {
  static properties = { open: { type: Boolean } };

  static styles = css`
    :host { display: contents; }
    .help-root { display:flex; gap:12px; width: min(90vw, 900px); min-width:320px; max-width:100%; }
    .help-list { width:260px; min-width:160px; max-width:34%; border-right:1px solid #e6e6e6; padding-right:12px; box-sizing:border-box; }
    .help-list .search { margin:8px 0; }
    .help-list input { width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid #ccc; border-radius:4px; }
    .help-list ul { list-style:none; padding:0; margin:8px 0 0 0; max-height:60vh; overflow:auto; }
    .help-list li { padding:6px 4px; cursor:pointer; border-radius:4px; }
    .help-list li:hover { background:#f3f3f3; }
    .help-list li.active { background:#eef6ff; }

    .help-panel { flex:1; padding-left:12px; box-sizing:border-box; max-height:70vh; overflow:auto; }
    .help-panel img { max-width:100%; height:auto; display:block; margin:8px 0; }
    .help-panel pre { background:#f6f6f6; padding:8px; overflow:auto; border-radius:4px; }
    .help-panel code { background:#f2f2f2; padding:2px 4px; border-radius:3px; }

    .modal-footer { display:flex; justify-content:flex-end; }
    .empty { color:#666; padding:12px; }
  `;

  constructor(){
    super();
    this.open = false;
    this.index = [];
    this.query = '';
    this.current = null;
    this.content = '';
    this._onModalClose = this._onModalClose.bind(this);
  }

  connectedCallback(){
    super.connectedCallback();
    this._loadIndex();
  }

  firstUpdated(){
    this.addEventListener('modal-close', this._onModalClose);
  }

  disconnectedCallback(){
    super.disconnectedCallback();
    this.removeEventListener('modal-close', this._onModalClose);
  }

  async _loadIndex(){
    try{
      const res = await fetch((window.APP_BASE_URL || '') + '/static/docs/index.json');
      if(res.ok) this.index = await res.json();
      else {
        console.warn('[HelpModal] index.json fetch returned', res.status);
        this.index = [];
      }
    }catch(e){ console.error('[HelpModal] failed to fetch index.json', e); this.index = []; }
    // Auto-select first document if available, otherwise show fallback message
    if(this.index.length){
      try{ await this._selectDoc(this.index[0]); }catch(e){ console.error('[HelpModal] _selectDoc error', e); this.content = '<div class="empty">Could not load the first document.</div>'; }
    } else {
      this.content = '<div class="empty">No documentation found. Add files to <code>www/docs/</code> and update <code>index.json</code>.</div>';
    }
    // ensure component updates then open inner modal so content is visible
    await this.updateComplete;
    const inner = this.renderRoot.querySelector('modal-lit'); if(inner){ inner.open = true; }
  }

  async _selectDoc(doc){
    if(!doc) return;
    this.current = doc;
    this.content = 'Loading...';
    this.requestUpdate();
    try{
      const res = await fetch((window.APP_BASE_URL || '') + `/static/docs/${doc.file}`);
      if(res.ok) {
        const md = await res.text();
        this.content = this._renderMarkdown(md, doc.file);
      } else this.content = `<div class="empty">Failed to load ${doc.title}</div>`;
    }catch(e){ this.content = '<div class="empty">Could not load document.</div>'; }
    this.requestUpdate();
    // scroll to top of panel
    const panel = this.renderRoot.querySelector('.help-panel'); if(panel) panel.scrollTop = 0;
  }

  _onModalClose(){ this.remove(); }

  async _showOnboarding(){
    try{
      // Dynamically import onboarding module if not already loaded, then append or reopen it
      try{ await import('./OnboardingModal.lit.js'); }catch(e){}
      let existing = document.querySelector('onboarding-modal');
      if(existing){
        try{ const inner = existing.renderRoot && existing.renderRoot.querySelector('modal-lit'); if(inner) inner.open = true; }
        catch(e){ /* ignore */ }
      } else {
        try{ const el = document.createElement('onboarding-modal'); document.body.appendChild(el); }catch(e){ console.warn('[HelpModal] failed to create onboarding element', e); }
      }
    }catch(e){ console.warn('[HelpModal] show onboarding failed', e); }
  }

  _filteredIndex(){
    const q = (this.query || '').trim().toLowerCase();
    if(!q) return this.index;
    return this.index.filter(d => (d.title || '').toLowerCase().includes(q) || (d.tags||[]).join(' ').toLowerCase().includes(q));
  }

  _escapeHtml(str){ return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  _renderMarkdown(md, srcFile){
    // very small markdown -> html renderer
    const lines = md.replace(/\r\n/g,'\n').split('\n');
    let html = '';
    let inCode = false;
    let codeLang = '';
    let listOpen = false;
    let listType = '';
    for(let line of lines){
      if(line.startsWith('```')){
        if(!inCode){ inCode = true; codeLang = line.slice(3).trim(); html += `<pre><code class="lang-${this._escapeHtml(codeLang)}">`; }
        else { inCode = false; html += '</code></pre>'; }
        continue;
      }
      if(inCode){ html += this._escapeHtml(line) + '\n'; continue; }
      // headings
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if(h){ const level = h[1].length; html += `<h${level}>${this._inline(h[2])}</h${level}>`; continue; }
      const olMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
      const ulMatch = line.match(/^\s*[-*]\s+(.*)$/);
      if(olMatch || ulMatch){
        const type = olMatch ? 'ol' : 'ul';
        const text = olMatch ? olMatch[2] : ulMatch[1];
        if(!listOpen){ listOpen = true; listType = type; html += `<${type}>`; }
        else if(listType !== type){ html += `</${listType}>`; listType = type; html += `<${type}>`; }
        html += `<li>${this._inline(text)}</li>`;
        continue;
      }
      if(listOpen){ listOpen = false; html += `</${listType}>`; listType = ''; }
      if(line.trim()==='') { html += '<p></p>'; continue; }
      html += `<p>${this._inline(line)}</p>`;
    }
    if(listOpen) html += `</${listType}>`;
    return html;
  }

  _inline(text){
    if(!text) return '';
    // images ![alt](url)
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m,alt,url)=>{
      const u = url.startsWith('http') ? url : `/static/docs/${url}`;
      return `<img src="${u}" alt="${this._escapeHtml(alt)}" />`;
    });
    // links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m,t,u)=>{
      if(u.startsWith('http')){
        return `<a href="${u}" target="_blank" rel="noreferrer">${this._escapeHtml(t)}</a>`;
      }
      // internal link: keep in-modal navigation using data attribute
      const safe = this._escapeHtml(u).replace(/"/g,'&quot;');
      return `<a href="#" data-internal="${safe}">${this._escapeHtml(t)}</a>`;
    });
    // inline code
    text = text.replace(/`([^`]+)`/g, (m,c)=>`<code>${this._escapeHtml(c)}</code>`);
    // bold **text**
    text = text.replace(/\*\*([^*]+)\*\*/g, (m,c)=>`<strong>${this._escapeHtml(c)}</strong>`);
    // italic *text*
    text = text.replace(/\*([^*]+)\*/g, (m,c)=>`<em>${this._escapeHtml(c)}</em>`);
    return text;
  }

  firstUpdated(){
    this.addEventListener('modal-close', this._onModalClose);
    // delegated click handler for internal doc links inside rendered markdown
    const panel = this.renderRoot.querySelector('.help-panel');
    if(panel){
      panel.addEventListener('click', (e)=>{
        const a = e.target.closest && e.target.closest('a[data-internal]');
        if(!a) return;
        e.preventDefault();
        const file = a.getAttribute('data-internal');
        if(!file) return;
        if(file.startsWith('#')){
          const target = panel.querySelector(file);
          if(target) target.scrollIntoView();
          return;
        }
        // attempt to open the referenced doc in the help modal
        try{ this._selectDoc({ file }); }catch(err){ console.warn('[HelpModal] failed to open internal link', err); }
      });
    }
  }

  render(){
    const list = this._filteredIndex();
    return html`
      <modal-lit ?open=${this.open}>
        <div slot="header"><h3>Help</h3></div>
        <div class="help-root">
          <div class="help-list">
            <div class="search"><input placeholder="Search docs..." @input=${e=>{ this.query = e.target.value; this.requestUpdate(); }} value=${this.query||''} /></div>
            <ul>
              ${list.map(d => html`<li class=${this.current && this.current.file===d.file ? 'active' : ''} @click=${()=>this._selectDoc(d)}>${d.title}</li>`)}
            </ul>
          </div>
          <div class="help-panel" .innerHTML=${this.content}></div>
        </div>
        <div slot="footer" class="modal-footer">
          <button class="btn secondary" @click=${()=>this._showOnboarding()}>Show Onboarding</button>
          <button class="btn" @click=${()=>{ const m = this.renderRoot.querySelector('modal-lit'); try{ if(m) m.close(); }catch(e){ this._onModalClose(); } }}>Close</button>
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('help-modal', HelpModal);
