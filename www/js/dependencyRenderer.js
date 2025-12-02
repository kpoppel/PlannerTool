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

function getCardCenterEdge(el, side){
  const board = document.getElementById('featureBoard');
  // Scroll container may be the parent (timeline-section) rather than board for vertical scroll.
  const verticalContainer = (board && board.parentElement && board.parentElement.classList.contains('timeline-section')) ? board.parentElement : board;
  const laneHeight = state && state.condensedCards ? 40 : 100;
  // Use inline layout positions for horizontal (left) & lane index for vertical, subtract scroll offsets from the active scroll container
  const leftStyle = parseFloat(el.style.left);
  const topStyle = parseFloat(el.style.top);
  const widthStyle = parseFloat(el.style.width);
  const scrollLeft = board ? board.scrollLeft : 0; // horizontal always comes from board
  const scrollTop = verticalContainer ? verticalContainer.scrollTop : 0; // vertical from parent if exists
  if(!isNaN(leftStyle) && !isNaN(topStyle)){
    const left = leftStyle - scrollLeft;
    const top = topStyle - scrollTop;
    const w = !isNaN(widthStyle) ? widthStyle : el.offsetWidth;
    const h = laneHeight; // fixed lane height ensures hidden content doesn't skew center
    if(side === 'right') return { x: left + w, y: top + h/2 };
    return { x: left, y: top + h/2 };
  }
  // Fallback bounding box relative to scroll container viewport if styles missing
  const r = el.getBoundingClientRect();
  const containerRect = verticalContainer ? verticalContainer.getBoundingClientRect() : { left:0, top:0 };
  const left = r.left - containerRect.left;
  const top = r.top - containerRect.top;
  if(side === 'right') return { x: left + r.width, y: top + r.height/2 };
  return { x: left, y: top + r.height/2 };
}

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
}

export function initDependencyRenderer(){
  function render(){
    const layer = createSvgLayer();
    if(!state.showDependencies){ clearLines(layer); return; }
    console.debug('[depRenderer] render called, showDependencies=', state.showDependencies);
    // Resize svg to match visible board viewport so coords map 1:1
    const board = document.getElementById('featureBoard');
    if(!board) return;
    const w = board.clientWidth; const h = board.clientHeight;
    layer.setAttribute('width', String(w));
    layer.setAttribute('height', String(h));
    layer.setAttribute('viewBox', `0 0 ${w} ${h}`);
    clearLines(layer);
    const features = state.getEffectiveFeatures();
    console.debug('[depRenderer] effective features count=', features.length);
    for(const f of features){
      if(f.dependsOn) console.debug('[depRenderer] feature', f.id, 'dependsOn=', f.dependsOn);
      if(!f.dependsOn || !Array.isArray(f.dependsOn)) continue;
      const targetCard = document.querySelector(`.feature-card[data-id="${f.id}"]`);
      if(!targetCard) continue;
      for(const depId of f.dependsOn){
        const sourceCard = document.querySelector(`.feature-card[data-id="${depId}"]`);
        if(!sourceCard) continue;
        const from = getCardCenterEdge(sourceCard,'right');
        const to = getCardCenterEdge(targetCard,'left');
        drawLine(layer, from, to);
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
  // Re-render on events
  bus.on('feature:updated', render);
  bus.on('view:dependencies', render);
  bus.on('projects:changed', render);
  bus.on('teams:changed', render);
  // Listen for drag intermediate updates
  bus.on('drag:move', render);
  // Window resize/scroll
  window.addEventListener('resize', render);
  const board = document.getElementById('featureBoard');
  if(board) board.addEventListener('scroll', render);
  // Also listen to vertical scroll on timeline-section parent
  if(board && board.parentElement && board.parentElement.classList.contains('timeline-section')){
    board.parentElement.addEventListener('scroll', render);
  }
  // initial render
  setTimeout(render, 100);
}
