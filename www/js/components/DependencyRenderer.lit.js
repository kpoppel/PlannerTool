// www/js/components/DependencyRenderer.lit.js
import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents, ProjectEvents, TeamEvents, DragEvents, ViewEvents } from '../core/EventRegistry.js';

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
    return html`<div id="depRendererRoot" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999"></div>`;
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
      svg.style.top = '0';
      svg.style.left = '0';
      svg.style.width = '100%';
      svg.style.height = '100%';
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

    // gather cards: prefer Lit hosts inside the board, fallback to document
    const cardById = new Map();
    const hostCandidates = [ ...(board.shadowRoot ? Array.from(board.shadowRoot.querySelectorAll('feature-card-lit')) : []), ...Array.from(document.querySelectorAll('feature-card-lit')) ];
    for (const h of hostCandidates) {
      const idAttr = h && h.getAttribute && h.getAttribute('data-feature-id');
      const idProp = h && h.feature && h.feature.id ? String(h.feature.id) : null;
      const id = idAttr || idProp;
      if (id) cardById.set(String(id), h);
    }

    // derive effective features via imported state module so tests can stub it
    const features = (state && typeof state.getEffectiveFeatures === 'function') ? state.getEffectiveFeatures() : [];
    const rendererRect = this.getBoundingClientRect();
    const scrollLeft = board ? board.scrollLeft : 0;
    const verticalContainer = (board && board.parentElement && board.parentElement.classList.contains('timeline-section')) ? board.parentElement : board;
    const verticalScrollTop = verticalContainer ? verticalContainer.scrollTop : 0;
    const laneHeight = (state && state.condensedCards) ? 40 : 100;

    function computeRect(el){
      try{
        if(el && el.shadowRoot){
          const inner = el.shadowRoot.querySelector('.feature-card');
          if(inner){ const r = inner.getBoundingClientRect(); return { left: r.left - rendererRect.left + scrollLeft, top: r.top - rendererRect.top + verticalScrollTop, width: r.width, height: r.height }; }
        }
      }catch(e){}
      const leftStyle = parseFloat(el.style.left); const topStyle = parseFloat(el.style.top);
      if(!isNaN(leftStyle) && !isNaN(topStyle)){
        const w = parseFloat(el.style.width) || el.offsetWidth; const h = parseFloat(el.style.height) || laneHeight; return { left: leftStyle, top: topStyle, width: w, height: h };
      }
      const r = el.getBoundingClientRect(); return { left: r.left - rendererRect.left + scrollLeft, top: r.top - rendererRect.top + verticalScrollTop, width: r.width, height: r.height };
    }
    function edgeOf(el, side){ const r = computeRect(el); return side === 'right' ? { x: r.left + r.width, y: r.top + r.height/2 } : { x: r.left, y: r.top + r.height/2 }; }
    function centerOf(el){ const r = computeRect(el); return { x: r.left + r.width/2, y: r.top + r.height/2 }; }

    const drawnPairs = new Set();
    for(let fi=0; fi<features.length; fi++){
      const f = features[fi];
      const relations = Array.isArray(f.relations) ? f.relations : null;
      if(!relations) continue;
      const targetCard = cardById.get(String(f.id));
      if(!targetCard) continue;
      for(let ri=0; ri<relations.length; ri++){
        const rel = relations[ri];
        let otherId = null; let relType = 'Related';
        if(typeof rel === 'string' || typeof rel === 'number'){ otherId = String(rel); relType = 'Predecessor'; }
        else if(rel && rel.id){ otherId = String(rel.id); relType = rel.type || rel.relationType || 'Related'; }
        else continue;
        if(relType === 'Child' || relType === 'Parent') continue;
        const otherCard = cardById.get(String(otherId));
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
    // Prefer any existing dependency-renderer inside the board root to share coordinates
    try{
      // Find the nearest scrollable ancestor so the overlay moves with the actual scroller
      function findScrollParent(el){
        let p = el.parentElement;
        while(p){
          try{
            const style = window.getComputedStyle(p);
            const oy = style.overflowY;
            const ox = style.overflowX;
            if(oy === 'auto' || oy === 'scroll' || ox === 'auto' || ox === 'scroll') return p;
          }catch(e){}
          p = p.parentElement;
        }
        return document.body;
      }

      const scrollParent = findScrollParent(board);
        // Insert renderer inside the board (or board.shadowRoot) so board.querySelector('svg') finds it
        const hostRoot = board.shadowRoot || board;
      let lit = hostRoot.querySelector && hostRoot.querySelector('dependency-renderer') || document.querySelector('dependency-renderer');
      if(!lit){
        lit = document.createElement('dependency-renderer');
          // Append into the board's root so queries under board find the SVG
          hostRoot.appendChild(lit);
        lit.style.position = 'absolute';
          // Fill the board area
          lit.style.top = '0'; lit.style.left = '0';
        try{ lit.style.width = `${board.scrollWidth || board.clientWidth}px`; }catch(e){ lit.style.width = '100%'; }
        try{ lit.style.height = `${board.scrollHeight || board.clientHeight}px`; }catch(e){ lit.style.height = '100%'; }
        lit.style.pointerEvents = 'none';
        lit.style.zIndex = '9999';

        // Only schedule redraws when horizontal scroll changes; vertical scroll will move the overlay along with the scroller
        let lastScrollLeft = board ? board.scrollLeft : 0;
        let scrollEndTimer = null;
        const SCROLL_END_DELAY = 120;
        const onScroll = ()=>{
          try{
            const nowLeft = board ? board.scrollLeft : 0;
            if(nowLeft !== lastScrollLeft){
              lastScrollLeft = nowLeft;
              // immediate redraw for horizontal change
              scheduleRender();
            }
            // always schedule a debounced full render in case layout changed
            if(scrollEndTimer) clearTimeout(scrollEndTimer);
            scrollEndTimer = setTimeout(()=>{ scrollEndTimer = null; scheduleRender(); }, SCROLL_END_DELAY);
          }catch(e){}
        };
          try{ scrollParent.addEventListener && scrollParent.addEventListener('scroll', onScroll); }catch(e){}
        window.addEventListener('resize', scheduleRender);
      }
      return lit;
    }catch(e){ return null; }
  }

  async function render(){
    // Respect global state flag if present
    if(!state.showDependencies){
      // collect renderers from document and from any feature-board shadow roots
      const lits = Array.from(document.querySelectorAll('dependency-renderer'));
      const boards = Array.from(document.querySelectorAll('feature-board'));
      for(const b of boards){
        try{
          if(b.shadowRoot){
            const s = b.shadowRoot.querySelector('dependency-renderer');
            if(s) lits.push(s);
          }
        }catch(e){}
      }
      // clear and remove each renderer
      for(const lit of lits){
        try{
          if(typeof lit.clear === 'function') lit.clear();
        }catch(e){}
        try{
          // remove from its parent if possible
          if(lit.remove) lit.remove();
        }catch(e){}
      }
      return;
    }
    try{
      const lit = await attachLitToBoard();
      if(lit){
        try{
          // show any document-level renderers
          const lits = Array.from(document.querySelectorAll('dependency-renderer'));
          for(const L of lits){ L.style.display = ''; }
          // also ensure renderer inside board shadowRoot is visible
          try{
            const boardShadow = (lit && lit.getRootNode && lit.getRootNode() && lit.getRootNode().host) ? lit.getRootNode().host : null;
            if(boardShadow && boardShadow.shadowRoot){
              const s = boardShadow.shadowRoot.querySelector('dependency-renderer');
              if(s) s.style.display = '';
            }
          }catch(e){}
        }catch(e){}
        if(lit.updateComplete){ try{ await lit.updateComplete; }catch(e){} }
        if(typeof lit.renderLayer === 'function'){ lit.renderLayer(); }
      }
    }catch(e){}
  }

  function scheduleRender(){ if(scheduled) return; scheduled = true; requestAnimationFrame(()=>{ scheduled = false; render(); }); }

  // Wire events directly to the shared bus and typed events
  try{
    bus.on(FeatureEvents.UPDATED, scheduleRender);
    bus.on(ViewEvents.DEPENDENCIES, scheduleRender);
    bus.on(ProjectEvents.CHANGED, scheduleRender);
    bus.on(TeamEvents.CHANGED, scheduleRender);
    bus.on(DragEvents.MOVE, scheduleRender);
  }catch(e){ /* ignore wiring failures */ }

  window.addEventListener('resize', scheduleRender);

  // If the board isn't present at init time, observe the document and attach scroll listener when it appears
  const boardNow = document.querySelector('feature-board');
  if(boardNow) boardNow.addEventListener('scroll', scheduleRender);
  else {
    const mo = new MutationObserver((records)=>{
      for(const r of records){
        for(const n of r.addedNodes){
          if(!n) continue;
          const isBoard = (n.tagName && n.tagName.toLowerCase && n.tagName.toLowerCase() === 'feature-board');
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
