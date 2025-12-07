import { state } from './state.js';
import { bus } from './eventBus.js';

// DEBUG: markers need to be visible above cards; set zIndex high while debugging.
const DEBUG_MARKERS = false; // temporary: set false to hide markers and render lines beneath cards

function createSvgLayer(){
  let layer = document.getElementById('dependencyLayer');
  if(layer) return layer;
  layer = document.createElementNS('http://www.w3.org/2000/svg','svg');
  layer.setAttribute('id','dependencyLayer');
  layer.style.position = 'absolute';
  layer.style.top = '0';
  layer.style.left = '0';
  layer.style.width = '100%';
  layer.style.height = '100%';
  layer.style.pointerEvents = 'none';
  // Debug markers
  layer.style.zIndex = DEBUG_MARKERS ? '999' : '0';
  const board = document.getElementById('featureBoard');
  if(board) board.style.position = 'relative';
  if(board){
    if(board.firstChild) board.insertBefore(layer, board.firstChild);
    else board.appendChild(layer);
  }
  return layer;
}

function clearLines(layer){ while(layer && layer.firstChild) layer.removeChild(layer.firstChild); }


function drawLine(layer, from, to){
  const ns = 'http://www.w3.org/2000/svg';
  // Use a smooth cubic Bezier curve from source to target.
  // Control points are offset horizontally to create a gentle S-curve.
  const dx = Math.max(20, Math.abs(to.x - from.x) * 0.4);
  const c1x = from.x + dx;
  const c1y = from.y;
  const c2x = to.x - dx;
  const c2y = to.y;
  const path = document.createElementNS(ns, 'path');
  const d = `M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`;
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#888');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  layer.appendChild(path);
  return path;
}

export function initDependencyRenderer(){
  function render(){
    const layer = createSvgLayer();
    if(!state.showDependencies){ clearLines(layer); return; }
    console.debug('[depRenderer] render called, showDependencies=', state.showDependencies);
    // Resize svg to match full scrollable board content so coords map to content coordinates
    const board = document.getElementById('featureBoard');
    if(!board) return;
    const w = board.scrollWidth || board.clientWidth; const h = board.scrollHeight || board.clientHeight;
    layer.setAttribute('width', String(w));
    layer.setAttribute('height', String(h));
    layer.setAttribute('viewBox', `0 0 ${w} ${h}`);
    // Make the rendered CSS size match the content pixel size so coordinates map 1:1
    layer.style.width = String(w) + 'px';
    layer.style.height = String(h) + 'px';
    layer.setAttribute('preserveAspectRatio', 'none');
    clearLines(layer);
    const features = state.getEffectiveFeatures();
    console.debug('[depRenderer] effective features count=', features.length);
    // Compute board geometry once
    const boardRect = board.getBoundingClientRect();
    const verticalContainer = (board && board.parentElement && board.parentElement.classList.contains('timeline-section')) ? board.parentElement : board;
    const verticalScrollTop = verticalContainer ? verticalContainer.scrollTop : 0;
    const scrollLeft = board ? board.scrollLeft : 0;
    const laneHeight = state && state.condensedCards ? 40 : 100;
    // Cache card elements by data-id to avoid repeated DOM queries
    const cardEls = document.querySelectorAll('.feature-card');
    const cardById = new Map();
    for(let i=0;i<cardEls.length;i++){ const el = cardEls[i]; const id = el.dataset && el.dataset.id; if(id) cardById.set(id, el); }

    // inline helpers using precomputed geometry
    function edgeOf(el, side){
      const leftStyle = parseFloat(el.style.left);
      const topStyle = parseFloat(el.style.top);
      const widthStyle = parseFloat(el.style.width);
      if(!isNaN(leftStyle) && !isNaN(topStyle)){
        const w = !isNaN(widthStyle) ? widthStyle : el.offsetWidth;
        const h = laneHeight;
        return side === 'right' ? { x: leftStyle + w, y: topStyle + h/2 } : { x: leftStyle, y: topStyle + h/2 };
      }
      const r = el.getBoundingClientRect();
      const left = r.left - boardRect.left + scrollLeft;
      const top = r.top - boardRect.top + verticalScrollTop;
      return side === 'right' ? { x: left + r.width, y: top + r.height/2 } : { x: left, y: top + r.height/2 };
    }
    function centerOf(el){
      const leftStyle = parseFloat(el.style.left);
      const topStyle = parseFloat(el.style.top);
      const widthStyle = parseFloat(el.style.width);
      const h = state && state.condensedCards ? 40 : (el.offsetHeight || 100);
      if(!isNaN(leftStyle) && !isNaN(topStyle)){
        const w = !isNaN(widthStyle) ? widthStyle : el.offsetWidth;
        return { x: leftStyle + w/2, y: topStyle + h/2 };
      }
      const r = el.getBoundingClientRect();
      const left = r.left - boardRect.left + scrollLeft;
      const top = r.top - boardRect.top + verticalScrollTop;
      return { x: left + r.width/2, y: top + r.height/2 };
    }

    // Track drawn pairs across the whole render pass to avoid duplicates when both
    // involved features list the same relation (A->B and B->A).
    const drawnPairs = new Set();
    for(let fi=0; fi<features.length; fi++){
      const f = features[fi];
      const relations = Array.isArray(f.relations) ? f.relations : null;
      if(!relations) continue;
      const targetCard = cardById.get(String(f.id)) || document.querySelector(`.feature-card[data-id="${f.id}"]`);
      if(!targetCard) continue;
      // loop relations
      for(let ri=0; ri<relations.length; ri++){
        const rel = relations[ri];
        // Normalize relation entry to { otherId, type }
        let otherId = null;
        let relType = 'Related'; // default fallback
        if(typeof rel === 'string' || typeof rel === 'number'){
          // simple id entry: treat as predecessor by default
          otherId = String(rel);
          relType = 'Predecessor';
        } else if(rel && rel.id){
          otherId = String(rel.id);
          relType = rel.type || rel.relationType || 'Related';
        } else {
          // unknown relation shape
          continue;
        }

        // Do not render Child relations
        if(relType === 'Child' || relType === 'Parent') continue;

        const otherCard = document.querySelector(`.feature-card[data-id="${otherId}"]`);
        if(!otherCard) continue;

        // Determine canonical key for pair (unordered) to avoid duplicates
        const pairKey = [otherId, f.id].sort().join('::');
        if(drawnPairs.has(pairKey)) continue;

        let from, to;
        if(relType === 'Successor'){
          from = edgeOf(targetCard, 'right'); // this card right
          to = edgeOf(otherCard, 'left');     // successor's left
        } else if(relType === 'Predecessor'){
          from = edgeOf(otherCard, 'right');
          to = edgeOf(targetCard, 'left');
        } else {
          // Related: draw center-to-center dashed line
          from = centerOf(otherCard);
          to = centerOf(targetCard);
        }

        // Draw the line and then tweak style for related links
        const path = drawLine(layer, from, to);
        if(relType === 'Related' && path){
          path.setAttribute('stroke-dasharray', '6,4');
          path.setAttribute('stroke', '#6a6'); // slightly green tint for related
          path.setAttribute('stroke-width', '1.5');
        }
        drawnPairs.add(pairKey);
      }
    }
    // Temporary debug markers: draw small boxes on the corners and center of every visible card
    if(DEBUG_MARKERS){
      const cards = Array.from(document.querySelectorAll('.feature-card'));
      for(const card of cards){
        const r = card.getBoundingClientRect();
        const boardRect = board.getBoundingClientRect();
        const left = r.left - boardRect.left;
        const top = r.top - boardRect.top;
        const w = r.width; const h = r.height;
        // small square size
        const s = 6;
        const ns = 'http://www.w3.org/2000/svg';
        // corners: top-left (red), top-right (green), bottom-left (blue), bottom-right (orange)
        const corners = [
          { x:left, y:top, color:'red' },
          { x:left + w - s, y:top, color:'green' },
          { x:left, y:top + h - s, color:'blue' },
          { x:left + w - s, y:top + h - s, color:'orange' }
        ];
        for(const c of corners){
          const rect = document.createElementNS(ns,'rect');
          rect.setAttribute('x', String(Math.round(c.x)));
          rect.setAttribute('y', String(Math.round(c.y)));
          rect.setAttribute('width', String(s));
          rect.setAttribute('height', String(s));
          rect.setAttribute('fill', c.color);
          rect.setAttribute('opacity', '0.9');
          layer.appendChild(rect);
        }
        // center dot (purple)
        const cx = left + w/2; const cy = top + h/2;
        const circ = document.createElementNS('http://www.w3.org/2000/svg','circle');
        circ.setAttribute('cx', String(Math.round(cx)));
        circ.setAttribute('cy', String(Math.round(cy)));
        circ.setAttribute('r', '4');
        circ.setAttribute('fill', 'purple');
        layer.appendChild(circ);
      }
    }
  }
  // Debounced scheduler: coalesce multiple rapid events into a single repaint
  let scheduled = false;
  function scheduleRender(){
    if(scheduled) return;
    scheduled = true;
    requestAnimationFrame(()=>{ scheduled = false; render(); });
  }

  // Re-render on events (use scheduler to avoid duplicate immediate calls)
  bus.on('feature:updated', scheduleRender);
  bus.on('view:dependencies', scheduleRender);
  bus.on('projects:changed', scheduleRender);
  bus.on('teams:changed', scheduleRender);
  // Listen for drag intermediate updates
  bus.on('drag:move', scheduleRender);
  // Window resize/scroll
  window.addEventListener('resize', scheduleRender);
  const board = document.getElementById('featureBoard');
  if(board) board.addEventListener('scroll', scheduleRender);
  // Also listen to vertical scroll on timeline-section parent
  if(board && board.parentElement && board.parentElement.classList.contains('timeline-section')){
    board.parentElement.addEventListener('scroll', scheduleRender);
  }
  // initial render
  setTimeout(scheduleRender, 100);
}
