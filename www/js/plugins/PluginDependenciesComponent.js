/**
 * PluginDependenciesComponent.js
 * Renders dependency arrows between feature cards as an SVG overlay.
 *
 * Converted from the standalone DependencyRenderer.lit.js component/function
 * into a proper plugin component that extends OverlaySvgPlugin.
 *
 * The overlay is always active once the plugin is registered (auto-activate).
 * Visibility is controlled by open()/close(), which are driven by PluginDependencies
 * on activate/deactivate and by ViewEvents.DEPENDENCIES on view restore.
 */

import { html } from '../vendor/lit.js';
import { OverlaySvgPlugin } from './OverlaySvgPlugin.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import {
  FeatureEvents,
  ProjectEvents,
  TeamEvents,
  DragEvents,
  ViewEvents,
  FilterEvents,
  AppEvents,
} from '../core/EventRegistry.js';
import { findInBoard } from '../components/board-utils.js';

const NS = 'http://www.w3.org/2000/svg';

export class PluginDependenciesComponent extends OverlaySvgPlugin {
  // Use a unique CSS class so the overlay div doesn't collide with other plugins
  static overlayClass = 'dependencies-overlay';
  // Render on top of all other content overlays
  static zIndex = '120';

  // No Lit properties beyond visible (inherited)

  constructor() {
    super();
    // Bound event handler references for reliable bus.off()
    this._onUpdate = this._scheduleRender.bind(this);
    this._onDepsToggle = this._handleDepsToggle.bind(this);
  }

  // No floating toolbar — dependencies are a passive overlay
  render() {
    return html``;
  }

  // ---------------------------------------------------------------------------
  // Bus subscriptions
  // ---------------------------------------------------------------------------

  _subscribeBusEvents() {
    bus.on(FeatureEvents.UPDATED, this._onUpdate);
    bus.on(ViewEvents.DEPENDENCIES, this._onDepsToggle);
    bus.on(ProjectEvents.CHANGED, this._onUpdate);
    bus.on(TeamEvents.CHANGED, this._onUpdate);
    bus.on(FilterEvents.CHANGED, this._onUpdate);
    bus.on(DragEvents.MOVE, this._onUpdate);
    bus.on(DragEvents.END, this._onUpdate);
    // Trigger initial render once the app signals it is ready
    bus.on(AppEvents.READY, this._onUpdate);
  }

  _unsubscribeBusEvents() {
    bus.off(FeatureEvents.UPDATED, this._onUpdate);
    bus.off(ViewEvents.DEPENDENCIES, this._onDepsToggle);
    bus.off(ProjectEvents.CHANGED, this._onUpdate);
    bus.off(TeamEvents.CHANGED, this._onUpdate);
    bus.off(FilterEvents.CHANGED, this._onUpdate);
    bus.off(DragEvents.MOVE, this._onUpdate);
    bus.off(DragEvents.END, this._onUpdate);
    bus.off(AppEvents.READY, this._onUpdate);
  }

  // ---------------------------------------------------------------------------
  // Dependencies toggle
  // ---------------------------------------------------------------------------

  /**
   * Called when ViewEvents.DEPENDENCIES fires (e.g. view restore or manual toggle).
   * Controls overlay visibility so saved view state is honoured.
   */
  _handleDepsToggle() {
    if (state?._viewService?.showDependencies) {
      this.open();
    } else {
      this.close();
    }
  }

  // ---------------------------------------------------------------------------
  // SVG rendering
  // ---------------------------------------------------------------------------

  _renderSvg() {
    if (!this._svgEl) return;

    const board = findInBoard('feature-board');
    if (!board) return;

    // Clear previous frame
    this._svgEl.innerHTML = '';

    // Collect cards from feature-board shadow DOM
    const cardById = new Map();
    const hostCards = Array.from(board.shadowRoot?.querySelectorAll('feature-card-lit') ?? []);
    for (const c of hostCards) {
      const id = c.getAttribute('data-feature-id');
      if (id) cardById.set(String(id), c);
    }

    const features = state.getEffectiveFeatures?.() ?? [];
    const laneHeight = state._viewService?.condensedCards ? 40 : 100;

    /**
     * Read the board-space rect of a card from its inline style.
     * Cards are positioned with explicit style.left / style.top inside feature-board,
     * which shares the same coordinate origin as #board-area (both position:relative/absolute
     * in the same stacking context), so no offset correction is needed.
     */
    const computeRect = (el) => {
      const leftStyle = parseFloat(el.style.left);
      const topStyle = parseFloat(el.style.top);
      if (isNaN(leftStyle) || isNaN(topStyle)) return null;
      const w = parseFloat(el.style.width) || el.offsetWidth;
      const h = parseFloat(el.style.height) || laneHeight;
      return { left: leftStyle, top: topStyle, width: w, height: h };
    };

    const edgeOf = (el, side) => {
      const r = computeRect(el);
      if (!r) return null;
      return side === 'right'
        ? { x: r.left + r.width, y: r.top + r.height / 2 }
        : { x: r.left, y: r.top + r.height / 2 };
    };

    const centerOf = (el) => {
      const r = computeRect(el);
      if (!r) return null;
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
        } else if (rel?.id) {
          otherId = String(rel.id);
          relType = rel.type || rel.relationType || 'Related';
        } else {
          continue;
        }

        // Parent/Child hierarchy links are not rendered as dependency lines
        if (relType === 'Child' || relType === 'Parent') continue;

        const other = cardById.get(String(otherId));
        if (!other) continue;

        // Draw each undirected pair only once
        const key = [otherId, String(f.id)].sort().join('::');
        if (drawn.has(key)) continue;

        let from, to;

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

        if (!from || !to) continue;

        this._drawBezier(from, to, {
          dashed: relType === 'Related',
          stroke: relType === 'Related' ? '#6a6' : '#888',
          width: relType === 'Related' ? 1.5 : 2,
        });

        drawn.add(key);
      }
    }
  }

  /**
   * Draw a cubic Bézier path between two board-space points.
   * @param {{ x:number, y:number }} from
   * @param {{ x:number, y:number }} to
   * @param {{ dashed?:boolean, stroke?:string, width?:number }} opts
   */
  _drawBezier(from, to, { dashed = false, stroke = '#888', width = 2 } = {}) {
    const dx = Math.max(20, Math.abs(to.x - from.x) * 0.4);
    const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', String(width));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    if (dashed) path.setAttribute('stroke-dasharray', '6,4');

    this._svgEl.appendChild(path);
    return path;
  }
}

customElements.define('plugin-dependencies', PluginDependenciesComponent);
export default PluginDependenciesComponent;
