import { LitElement, html } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import {
  FeatureEvents,
  ProjectEvents,
  TeamEvents,
  DragEvents,
  ViewEvents,
  AppEvents,
  FilterEvents,
} from '../core/EventRegistry.js';
import { findInBoard } from './board-utils.js';

class DependencyRenderer extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        id="depRendererRoot"
        style="position:relative;width:100%;height:100%;pointer-events:none"
      ></div>
    `;
  }

  firstUpdated() {
    const root =
      this.querySelector('#depRendererRoot') ||
      (() => {
        const d = document.createElement('div');
        d.id = 'depRendererRoot';
        d.style.position = 'relative';
        d.style.width = '100%';
        d.style.height = '100%';
        this.appendChild(d);
        return d;
      })();

    let svg = root.querySelector('svg');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'dependencyLayer';
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

  clear() {
    if (!this._svg) return;
    this._svg.textContent = '';
  }

  drawLine(from, to, { dashed = false, stroke = '#888', width = 2 } = {}) {
    if (!this._svg) return null;

    const ns = 'http://www.w3.org/2000/svg';
    const dx = Math.max(20, Math.abs(to.x - from.x) * 0.4);
    const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;

    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', String(width));
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    if (dashed) p.setAttribute('stroke-dasharray', '6,4');

    this._svg.appendChild(p);
    return p;
  }

  renderLayer() {
    const board = findInBoard('feature-board');
    const w = board.scrollWidth;
    const h = board.scrollHeight;

    if (this._svg) {
      this._svg.setAttribute('width', String(w));
      this._svg.setAttribute('height', String(h));
      this._svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      this._svg.setAttribute('preserveAspectRatio', 'none');
      this._svg.style.width = `${w}px`;
      this._svg.style.height = `${h}px`;
    }
    this.clear();

    // Collect cards from feature-board shadowRoot
    const cardById = new Map();
    const hostCards = Array.from(board.shadowRoot.querySelectorAll('feature-card-lit'));
    for (const c of hostCards) {
      const id = c.getAttribute('data-feature-id');
      cardById.set(String(id), c);
    }

    const features = state.getEffectiveFeatures();
    const laneHeight = state._viewService.condensedCards ? 40 : 100;

    const computeRect = (el) => {
      const leftStyle = parseFloat(el.style.left);
      const topStyle = parseFloat(el.style.top);
      if (!isNaN(leftStyle) && !isNaN(topStyle)) {
        const w = parseFloat(el.style.width) || el.offsetWidth;
        const h = parseFloat(el.style.height) || laneHeight;
        return { left: leftStyle, top: topStyle, width: w, height: h };
      }
    };

    const edgeOf = (el, side) => {
      const r = computeRect(el);
      if (side === 'right') return { x: r.left + r.width, y: r.top + r.height / 2 };
      return { x: r.left, y: r.top + r.height / 2 };
    };

    const centerOf = (el) => {
      const r = computeRect(el);
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    const drawn = new Set();

    for (const f of features) {
      const relations = Array.isArray(f.relations) ? f.relations : null;
      if (!relations) continue;

      const target = cardById.get(String(f.id));
      if (!target) continue;

      for (const rel of relations) {
        let otherId = null;
        let relType = 'Related';

        if (typeof rel === 'string' || typeof rel === 'number') {
          otherId = String(rel);
          relType = 'Predecessor';
        } else if (rel && rel.id) {
          otherId = String(rel.id);
          relType = rel.type || rel.relationType || 'Related';
        } else {
          continue;
        }

        if (relType === 'Child' || relType === 'Parent') continue;

        const other = cardById.get(String(otherId));
        if (!other) continue;

        const key = [otherId, f.id].sort().join('::');
        if (drawn.has(key)) continue;

        let from;
        let to;

        if (relType === 'Successor') {
          from = edgeOf(target, 'right');
          to = edgeOf(other, 'left');
        } else if (relType === 'Predecessor') {
          from = edgeOf(other, 'right');
          to = edgeOf(target, 'left');
        } else {
          from = centerOf(other);
          to = centerOf(target);
        }

        this.drawLine(from, to, {
          dashed: relType === 'Related',
          stroke: relType === 'Related' ? '#6a6' : '#888',
          width: relType === 'Related' ? 1.5 : 2,
        });

        drawn.add(key);
      }
    }
  }
}

customElements.define('dependency-renderer', DependencyRenderer);

export async function initDependencyRenderer() {
  let scheduled = false;

  const scheduleRender = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  };

  async function attach() {
    const board = findInBoard('feature-board');
    if (!board) return null;

    const hostRoot = board.shadowRoot;
    let lit = hostRoot.querySelector('dependency-renderer');

    if (!lit) {
      lit = document.createElement('dependency-renderer');
      hostRoot.appendChild(lit);
    }

    lit.style.position = 'absolute';
    lit.style.top = '0';
    lit.style.left = '0';
    lit.style.width = `${board.scrollWidth}px`;
    lit.style.height = `${board.scrollHeight}px`;
    lit.style.pointerEvents = 'none';
    lit.style.zIndex = '9999';
    lit.style.display = '';

    if (!lit._depRendererInit) {
      lit._depRendererInit = true;
      const scrollParent = (function find(el) {
        let p = el.parentElement;
        while (p) {
          const s = window.getComputedStyle(p);
          if (
            ['auto', 'scroll'].includes(s.overflowY) ||
            ['auto', 'scroll'].includes(s.overflowX)
          )
            return p;
          p = p.parentElement;
        }
        return document.body;
      })(board);

      let lastLeft = board.scrollLeft;
      let scrollEndTimer = null;
      const SCROLL_END_DELAY = 120;

      const onScroll = () => {
        const now = board.scrollLeft;
        if (now !== lastLeft) {
          lastLeft = now;
          scheduleRender();
        }
        if (scrollEndTimer) clearTimeout(scrollEndTimer);
        scrollEndTimer = setTimeout(() => {
          scrollEndTimer = null;
          scheduleRender();
        }, SCROLL_END_DELAY);
      };

      if (scrollParent && scrollParent.addEventListener)
        scrollParent.addEventListener('scroll', onScroll);
      window.addEventListener('resize', scheduleRender);
    }

    return lit;
  }

  async function render() {
    if (!(state && state._viewService.showDependencies)) {
      const board = findInBoard('feature-board');
      if (board && board.shadowRoot) {
        const lit = board.shadowRoot.querySelector('dependency-renderer');
        if (lit) {
          if (typeof lit.clear === 'function') lit.clear();
          lit.style.display = 'none';
        }
      }
      return;
    }

    const lit = await attach();
    lit.style.display = '';
    await lit.updateComplete;
    lit.renderLayer();
  }

  bus.on(FeatureEvents.UPDATED, scheduleRender);
  bus.on(ViewEvents.DEPENDENCIES, scheduleRender);
  bus.on(ProjectEvents.CHANGED, scheduleRender);
  bus.on(TeamEvents.CHANGED, scheduleRender);
  bus.on(FilterEvents.CHANGED, scheduleRender);
  bus.on(DragEvents.MOVE, scheduleRender);
  bus.on(DragEvents.END, scheduleRender);
  bus.on(AppEvents.READY, () => setTimeout(scheduleRender, 0));

  window.addEventListener('resize', scheduleRender);

  const boardNow = findInBoard('feature-board');
  if (boardNow) {
    boardNow.addEventListener('scroll', scheduleRender);
  } else {
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (!n) continue;
          const isBoard =
            n.tagName &&
            n.tagName.toLowerCase &&
            n.tagName.toLowerCase() === 'feature-board';
          if (isBoard) {
            n.addEventListener('scroll', scheduleRender);
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
