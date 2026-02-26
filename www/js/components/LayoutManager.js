// Lightweight LayoutManager
// Provides a single source of truth for feature card geometries

import { laneHeight } from './board-utils.js';

export class LayoutManager {
  constructor(board) {
    this.board = board;
    this._geomMap = new Map(); // id -> { left, top, width, height }
    this._boardClientRect = null; // cached client rect of board (left/top in page coords)
    this._dirtySet = new Set();
    this._scrollLeft = 0;
    this._scrollTop = 0;
  }

  // Seed geometries from the render list (fast, no DOM reads)
  recomputeAll(renderList = []) {
    if (!Array.isArray(renderList)) return;
    for (const item of renderList) {
      const id = item.feature && item.feature.id;
      if (!id) continue;
      const left = typeof item.left === 'number' ? item.left : (item.left || 0);
      const top = typeof item.top === 'number' ? item.top : (item.top || 0);
      const width = typeof item.width === 'number' ? item.width : (item.width || 0);
      const height = laneHeight();
      this._geomMap.set(String(id), { left, top, width, height });
    }
  }

  getGeometry(id) {
    if (!id) return null;
    return this._geomMap.get(String(id)) || null;
  }

  setGeometry(id, geom = {}) {
    if (!id || !geom) return;
    const prev = this._geomMap.get(String(id)) || {};
    const next = {
      left: geom.left != null ? geom.left : (prev.left || 0),
      top: geom.top != null ? geom.top : (prev.top || 0),
      width: geom.width != null ? geom.width : (prev.width || 0),
      height: geom.height != null ? geom.height : (prev.height || laneHeight())
    };
    this._geomMap.set(String(id), next);
    return next;
  }

  // Return the current board viewport rectangle (scroll position + viewport size)
  getBoardRect() {
    // Prefer cached board client rect and scroll values to avoid forcing
    // layout reads on every call. FeatureBoard should update these values
    // via `setBoardClientRect` and `setBoardScroll` when the board changes.
    try {
      const left = this._scrollLeft || 0;
      const top = this._scrollTop || 0;
      const width = (this._boardClientRect && this._boardClientRect.width) || (this.board && this.board.clientWidth) || 0;
      const height = (this._boardClientRect && this._boardClientRect.height) || (this.board && this.board.clientHeight) || 0;
      return { left, top, width, height };
    } catch (e) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
  }

  // Store a client rect representing the board's bounding client rect
  setBoardClientRect(rect = null) {
    try {
      if (!rect) return;
      // Normalize
      this._boardClientRect = {
        left: rect.left != null ? rect.left : (rect.x || 0),
        top: rect.top != null ? rect.top : (rect.y || 0),
        width: rect.width || 0,
        height: rect.height || 0
      };
    } catch (e) { /* ignore */ }
  }

  // Set the current scroll position of the board. Call from board scroll handler.
  setBoardScroll(left = 0, top = 0) {
    try {
      this._scrollLeft = left || 0;
      this._scrollTop = top || 0;
    } catch (e) { /* ignore */ }
  }

  getBoardClientRect() {
    return this._boardClientRect || { left: 0, top: 0, width: 0, height: 0 };
  }

  // Mark a feature id as dirty meaning its DOM geometry should be re-measured
  markDirty(id) {
    if (!id) return;
    try { this._dirtySet.add(String(id)); } catch (e) { }
  }

  // Get and clear the current dirty ids as an array
  consumeDirtyIds() {
    const arr = Array.from(this._dirtySet);
    this._dirtySet.clear();
    return arr;
  }

  // Return a shallow snapshot (for debugging)
  snapshot() {
    return new Map(this._geomMap);
  }
}

export default LayoutManager;
