import { LitElement, html } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents, ProjectEvents, TeamEvents, DragEvents, ViewEvents } from '../core/EventRegistry.js';

class DependencyRenderer extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div id="depRendererRoot" style="position:relative;width:100%;height:100%;pointer-events:none"></div>
    `;
  }

  firstUpdated() {
    const root = this.querySelector('#depRendererRoot') || (() => {
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
    const board = document.querySelector('feature-board');
    if (!board) {
      this.clear();
      return;
    }

    const w = board.scrollWidth || board.clientWidth;
    const h = board.scrollHeight || board.clientHeight;

    if (this._svg) {
      this._svg.setAttribute('width', String(w));
      this._svg.setAttribute('height', String(h));
      this._svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      this._svg.setAttribute('preserveAspectRatio', 'none');
      this._svg.style.width = `${w}px`;
      this._svg.style.height = `${h}px`;
    }

    this.clear();

    const hostCards = board.shadowRoot ? Array.from(board.shadowRoot.querySelectorAll('feature-card-lit')) : [];
    const docCards = Array.from(document.querySelectorAll('feature-card-lit'));
    const cardById = new Map();

    for (const c of [...hostCards, ...docCards]) {
      const id = (c.getAttribute && c.getAttribute('data-feature-id')) || (c.feature && c.feature.id && String(c.feature.id));
      if (id) cardById.set(String(id), c);
    }

    const features = (state && typeof state.getEffectiveFeatures === 'function') ? state.getEffectiveFeatures() : [];
    const bbox = this.getBoundingClientRect();
    const scrollLeft = board.scrollLeft || 0;
    const verticalContainer = (board.parentElement && board.parentElement.classList && board.parentElement.classList.contains('timeline-section')) ? board.parentElement : board;
    const verticalScrollTop = verticalContainer ? verticalContainer.scrollTop : 0;
    const laneHeight = (state && state.condensedCards) ? 40 : 100;

    const computeRect = (el) => {
      try {
        if (el && el.shadowRoot) {
          const inner = el.shadowRoot.querySelector('.feature-card');
          if (inner) {
            const r = inner.getBoundingClientRect();
            return {
              left: r.left - bbox.left + scrollLeft,
              top: r.top - bbox.top + verticalScrollTop,
              width: r.width,
              height: r.height
            };
          }
        }
      } catch (e) {
        // ignore and fallback
      }

      const leftStyle = parseFloat(el.style.left);
      const topStyle = parseFloat(el.style.top);

      if (!isNaN(leftStyle) && !isNaN(topStyle)) {
        const w = parseFloat(el.style.width) || el.offsetWidth;
        const h = parseFloat(el.style.height) || laneHeight;
        return { left: leftStyle, top: topStyle, width: w, height: h };
      }

      const r = el.getBoundingClientRect();
      return {
        left: r.left - bbox.left + scrollLeft,
        top: r.top - bbox.top + verticalScrollTop,
        width: r.width,
        height: r.height
      };
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
          width: relType === 'Related' ? 1.5 : 2
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
    const board = document.querySelector('feature-board');
    if (!board) return null;

    try {
      const hostRoot = board.shadowRoot || board;

      let lit = (hostRoot.querySelector && hostRoot.querySelector('dependency-renderer')) || document.querySelector('dependency-renderer');

      if (!lit) {
        lit = document.createElement('dependency-renderer');
        hostRoot.appendChild(lit);

        lit.style.position = 'absolute';
        lit.style.top = '0';
        lit.style.left = '0';

        try {
          lit.style.width = `${board.scrollWidth || board.clientWidth}px`;
        } catch (e) {
          lit.style.width = '100%';
        }

        try {
          lit.style.height = `${board.scrollHeight || board.clientHeight}px`;
        } catch (e) {
          lit.style.height = '100%';
        }

        lit.style.pointerEvents = 'none';
        lit.style.zIndex = '9999';

        const scrollParent = (function find(el) {
          let p = el.parentElement;
          while (p) {
            try {
              const s = window.getComputedStyle(p);
              if (['auto', 'scroll'].includes(s.overflowY) || ['auto', 'scroll'].includes(s.overflowX)) return p;
            } catch (e) {
              // ignore
            }
            p = p.parentElement;
          }
          return document.body;
        })(board);

        let lastLeft = board.scrollLeft || 0;
        let scrollEndTimer = null;
        const SCROLL_END_DELAY = 120;

        const onScroll = () => {
          try {
            const now = board.scrollLeft || 0;
            if (now !== lastLeft) {
              lastLeft = now;
              scheduleRender();
            }
            if (scrollEndTimer) clearTimeout(scrollEndTimer);
            scrollEndTimer = setTimeout(() => {
              scrollEndTimer = null;
              scheduleRender();
            }, SCROLL_END_DELAY);
          } catch (e) {
            // ignore
          }
        };

        try {
          if (scrollParent && scrollParent.addEventListener) scrollParent.addEventListener('scroll', onScroll);
        } catch (e) {
          // ignore
        }

        window.addEventListener('resize', scheduleRender);
      }

      return lit;
    } catch (e) {
      return null;
    }
  }

  async function render() {
    if (!(state && state.showDependencies)) {
      const lits = Array.from(document.querySelectorAll('dependency-renderer'));
      const boards = Array.from(document.querySelectorAll('feature-board'));

      for (const b of boards) {
        try {
          if (b.shadowRoot) {
            const s = b.shadowRoot.querySelector('dependency-renderer');
            if (s) lits.push(s);
          }
        } catch (e) {
          // ignore
        }
      }

      for (const lit of lits) {
        try {
          if (typeof lit.clear === 'function') lit.clear();
        } catch (e) {
          // ignore
        }
        try {
          if (lit.remove) lit.remove();
        } catch (e) {
          // ignore
        }
      }

      return;
    }

    try {
      const lit = await attach();
      if (lit) {
        try {
          const lits = Array.from(document.querySelectorAll('dependency-renderer'));
          for (const L of lits) L.style.display = '';

          const host = (lit.getRootNode && lit.getRootNode().host) ? lit.getRootNode().host : null;
          if (host && host.shadowRoot) {
            const s = host.shadowRoot.querySelector('dependency-renderer');
            if (s) s.style.display = '';
          }
        } catch (e) {
          // ignore
        }

        if (lit.updateComplete) {
          try { await lit.updateComplete; } catch (e) { /* ignore */ }
        }

        if (typeof lit.renderLayer === 'function') lit.renderLayer();
      }
    } catch (e) {
      // ignore
    }
  }

  try {
    bus.on(FeatureEvents.UPDATED, scheduleRender);
    bus.on(ViewEvents.DEPENDENCIES, scheduleRender);
    bus.on(ProjectEvents.CHANGED, scheduleRender);
    bus.on(TeamEvents.CHANGED, scheduleRender);
    bus.on(DragEvents.MOVE, scheduleRender);
  } catch (e) {
    // ignore wiring failures
  }

  window.addEventListener('resize', scheduleRender);

  const boardNow = document.querySelector('feature-board');
  if (boardNow) {
    boardNow.addEventListener('scroll', scheduleRender);
  } else {
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (!n) continue;
          const isBoard = (n.tagName && n.tagName.toLowerCase && n.tagName.toLowerCase() === 'feature-board');
          if (isBoard) {
            try { n.addEventListener('scroll', scheduleRender); } catch (e) { /* ignore */ }
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
