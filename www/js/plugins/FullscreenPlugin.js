/**
 * FullscreenPlugin - Extends MountedPlugin to hide/show the timeline-board
 * when the plugin is active (fullscreen mode).
 *
 * This mixin adds the third duplicated pattern across 6 fullscreen plugins:
 * - Save `timeline-board.style.display` before hiding, restore after showing
 * - Hide timeline-board on activate, show on deactivate
 *
 * Subclasses use inheritance: `class MyPlugin extends FullscreenPlugin { ... }`
 * and only need to provide the MountedPlugin hooks (`componentTag`, `componentPath`,
 * `mountSelector`) plus any plugin-specific extras (state save, config assignment, etc.).
 */
import { MountedPlugin } from './MountedPlugin.js';

const TIMELINE_BOARD_SELECTOR = 'timeline-board';

export class FullscreenPlugin extends MountedPlugin {
  /** @type {string} Saved display value for the timeline-board element. */
  _savedTimelineBoardDisplay = '';

  /* ── overrides: always fullscreen ───────────────────────────────────── */

  get mountSelector() { return 'app'; }

  /* ── activate: hide timeline-board ──────────────────────────────────── */

  async activate() {
    await super.activate();
    this._hideTimelineBoard();
  }

  /* ── deactivate: show timeline-board ────────────────────────────────── */

  async deactivate() {
    this._showTimelineBoard();
    await super.deactivate();
  }

  /* ── timeline-board helpers ─────────────────────────────────────────── */

  _hideTimelineBoard() {
    const tb = document.querySelector(TIMELINE_BOARD_SELECTOR);
    if (!tb) return;
    this._savedTimelineBoardDisplay = tb.style.display || '';
    tb.style.display = 'none';
  }

  _showTimelineBoard() {
    const tb = document.querySelector(TIMELINE_BOARD_SELECTOR);
    if (!tb) return;
    tb.style.display = this._savedTimelineBoardDisplay || '';
  }
}
