// www/js/components/DependencyRenderer.lit.js
import { LitElement, html, css } from '../vendor/lit.js';
import { isEnabled } from '../config.js';
import { state } from '../services/State.js';

export class DependencyRendererLit extends LitElement {
  static properties = {
    debug: { type: Boolean }
  };

  constructor(){
    super();
    this.debug = false;
    this._svg = null;
  }

  // Render into light DOM so consumers (and tests) can query for the SVG under the board
  createRenderRoot(){ return this; }

  render(){
    // Render a container for the dependency SVG; actual SVG is created/managed imperatively
    return html`<div id="depRendererRoot" style="position:relative;width:100%;height:100%;pointer-events:none"></div>`;
  }

  firstUpdated(){
    // Ensure an SVG exists in the host; if the template root is not present yet, create it.
    let root = this.querySelector('#depRendererRoot');
    if(!root){
      root = document.createElement('div');
      root.setAttribute('id','depRendererRoot');
      root.style.position = 'relative'; root.style.width = '100%'; root.style.height = '100%'; root.style.pointerEvents = 'none';
      this.appendChild(root);
    }
    let svg = root.querySelector('svg');
    if(!svg){
      svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('id','dependencyLayer');
      svg.style.position = 'absolute';
      svg.style.top = '0'; svg.style.left = '0'; svg.style.width = '100%'; svg.style.height = '100%';
      svg.style.pointerEvents = 'none';
      root.appendChild(svg);
    }
    this._svg = svg;
  }

  clear(){
    if(!this._svg) return;
    while(this._svg.firstChild) this._svg.removeChild(this._svg.firstChild);
  }

  drawLine(from, to, opts={}){
    if(!this._svg) return null;
    const ns = 'http://www.w3.org/2000/svg';
    const dx = Math.max(20, Math.abs(to.x - from.x) * 0.4);
    const c1x = from.x + dx; const c1y = from.y;
    const c2x = to.x - dx; const c2y = to.y;
    const path = document.createElementNS(ns, 'path');
    const d = `M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`;
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', opts.stroke || '#888');
    path.setAttribute('stroke-width', String(opts.width || 2));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    if(opts.dashed) path.setAttribute('stroke-dasharray', '6,4');
    this._svg.appendChild(path);
    return path;
  }

  // Public: compute geometry from board and draw dependencies similar to legacy renderer
  renderLayer(){
    // find board element
    const board = document.querySelector('feature-board');
    if(!board){ this.clear(); return; }
    // ensure svg is sized to board content
    const w = board.scrollWidth || board.clientWidth; const h = board.scrollHeight || board.clientHeight;
    if(this._svg){
      this._svg.setAttribute('width', String(w)); this._svg.setAttribute('height', String(h));
      this._svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      this._svg.setAttribute('preserveAspectRatio','none');
      this._svg.style.width = `${w}px`; this._svg.style.height = `${h}px`;
    }
    this.clear();

    // gather cards (legacy and lit-hosted)
    const cardById = new Map();
    const cardEls = Array.from(document.querySelectorAll('.feature-card'));
    for(const el of cardEls){ const id = (el.dataset && el.dataset.id) || el.getAttribute('data-id'); if(id) cardById.set(String(id), el); }
    const hostEls = Array.from(document.querySelectorAll('[data-feature-id]'));
    for(const h of hostEls){ const id = h.getAttribute('data-feature-id'); if(id) cardById.set(String(id), h); }

    // derive effective features via imported state module so tests can stub it
    const features = (state && typeof state.getEffectiveFeatures === 'function') ? state.getEffectiveFeatures() : [];
    const boardRect = board.getBoundingClientRect();
    const scrollLeft = board ? board.scrollLeft : 0;
    const verticalContainer = (board && board.parentElement && board.parentElement.classList.contains('timeline-section')) ? board.parentElement : board;
    const verticalScrollTop = verticalContainer ? verticalContainer.scrollTop : 0;
    const laneHeight = (state && state.condensedCards) ? 40 : 100;

    function edgeOf(el, side){
      const leftStyle = parseFloat(el.style.left);
      const topStyle = parseFloat(el.style.top);
      const widthStyle = parseFloat(el.style.width);
      if(!isNaN(leftStyle) && !isNaN(topStyle)){
        const w = !isNaN(widthStyle) ? widthStyle : el.offsetWidth; const h = laneHeight;
        return side === 'right' ? { x: leftStyle + w, y: topStyle + h/2 } : { x: leftStyle, y: topStyle + h/2 };
      }
      const r = el.getBoundingClientRect();
      const left = r.left - boardRect.left + scrollLeft; const top = r.top - boardRect.top + verticalScrollTop;
      return side === 'right' ? { x: left + r.width, y: top + r.height/2 } : { x: left, y: top + r.height/2 };
    }
    function centerOf(el){
      const leftStyle = parseFloat(el.style.left); const topStyle = parseFloat(el.style.top); const widthStyle = parseFloat(el.style.width);
      const h = (window.state && window.state.condensedCards) ? 40 : (el.offsetHeight || 100);
      if(!isNaN(leftStyle) && !isNaN(topStyle)){
        const w = !isNaN(widthStyle) ? widthStyle : el.offsetWidth; return { x: leftStyle + w/2, y: topStyle + h/2 };
      }
      const r = el.getBoundingClientRect(); const left = r.left - boardRect.left + scrollLeft; const top = r.top - boardRect.top + verticalScrollTop;
      return { x: left + r.width/2, y: top + r.height/2 };
    }

    const drawnPairs = new Set();
    for(let fi=0; fi<features.length; fi++){
      const f = features[fi];
      const relations = Array.isArray(f.relations) ? f.relations : null;
      if(!relations) continue;
      const targetCard = cardById.get(String(f.id)) || document.querySelector(`.feature-card[data-id="${f.id}"]`) || document.querySelector(`[data-feature-id="${f.id}"]`);
      if(!targetCard) continue;
      for(let ri=0; ri<relations.length; ri++){
        const rel = relations[ri];
        let otherId = null; let relType = 'Related';
        if(typeof rel === 'string' || typeof rel === 'number'){ otherId = String(rel); relType = 'Predecessor'; }
        else if(rel && rel.id){ otherId = String(rel.id); relType = rel.type || rel.relationType || 'Related'; }
        else continue;
        if(relType === 'Child' || relType === 'Parent') continue;
        const otherCard = cardById.get(String(otherId)) || document.querySelector(`.feature-card[data-id="${otherId}"]`) || document.querySelector(`[data-feature-id="${otherId}"]`);
        if(!otherCard) continue;
        const pairKey = [otherId, f.id].sort().join('::'); if(drawnPairs.has(pairKey)) continue;
        let from, to;
        if(relType === 'Successor') { from = edgeOf(targetCard, 'right'); to = edgeOf(otherCard, 'left'); }
        else if(relType === 'Predecessor') { from = edgeOf(otherCard, 'right'); to = edgeOf(targetCard, 'left'); }
        else { from = centerOf(otherCard); to = centerOf(targetCard); }
        const path = this.drawLine(from, to, { dashed: relType === 'Related', stroke: relType === 'Related' ? '#6a6' : '#888', width: relType === 'Related' ? 1.5 : 2 });
        drawnPairs.add(pairKey);
      }
    }
  }
}

customElements.define('dependency-renderer', DependencyRendererLit);

// Export a lightweight initializer so callers can use the Lit component directly
export async function initDependencyRenderer(){
  let scheduled = false;

  async function attachLitToBoard(){
    const board = document.querySelector('feature-board');
    if(!board) return null;
    if(!customElements.get('dependency-renderer')){
      try{ /* component already defined above; noop */ }catch(e){}
    }
    let lit = board.querySelector('dependency-renderer');
    if(!lit){
      try{ lit = document.createElement('dependency-renderer'); board.insertBefore(lit, board.firstChild); }
      catch(e){ return null; }
    }
    return lit;
  }

  async function render(){
    // Respect global state flag if present
    if(!state.showDependencies){
      const board = document.querySelector('feature-board');
      if(board){
        const lit = board.querySelector('dependency-renderer');
        if(lit && typeof lit.clear === 'function') lit.clear();
      }
      return;
    }
    try{
      const lit = await attachLitToBoard();
      if(lit){ if(lit.updateComplete){ try{ await lit.updateComplete; }catch(e){} } if(typeof lit.renderLayer === 'function'){ lit.renderLayer(); } }
    }catch(e){}
  }

  function scheduleRender(){ if(scheduled) return; scheduled = true; requestAnimationFrame(()=>{ scheduled = false; render(); }); }

  // Wire events
  import('../core/EventBus.js').then(({ bus })=>{
    import('../core/EventRegistry.js').then(({ FeatureEvents, ProjectEvents, TeamEvents, DragEvents, ViewEvents })=>{
      bus.on(FeatureEvents.UPDATED, scheduleRender);
      bus.on(ViewEvents.DEPENDENCIES, scheduleRender);
      bus.on(ProjectEvents.CHANGED, scheduleRender);
      bus.on(TeamEvents.CHANGED, scheduleRender);
      bus.on(DragEvents.MOVE, scheduleRender);
    });
  }).catch(()=>{});

  window.addEventListener('resize', scheduleRender);
  const boardNow = document.querySelector('feature-board');
  if(boardNow) boardNow.addEventListener('scroll', scheduleRender);
  else {
    const mo = new MutationObserver((records)=>{
      for(const r of records){
        for(const n of r.addedNodes){
          if(!n) continue;
          const isBoard = (n.tagName === 'feature-board');
          if(isBoard){
            try{ n.addEventListener('scroll', scheduleRender); }catch(e){}
            scheduleRender();
            mo.disconnect();
            return;
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(scheduleRender, 100);
}
