/**
 * FeatureBoard.styles.js
 *
 * CSS for the <feature-board> Lit component, extracted to keep the component
 * file focused on logic.  Import and assign to `static styles` in FeatureBoard.
 */
import { css } from '../vendor/lit.js';
import { SWIMLANE_LABEL_WIDTH_PX } from '../services/SwimlaneService.js';

export const featureBoardStyles = css`
  :host {
    display: block;
    /* No overflow — scroll is handled by the parent #scroll-container in TimelineBoard.
       Width and height are set programmatically to the full content dimensions so that
       plugin SVG overlays inside the shadow root can use position:absolute & inset:0. */
    position: relative;
    overflow: visible;
    padding: 0;
    /* No background — stripes are on #board-area which spans the full content width.
       feature-board is transparent so the parent background shows through. */
    background: transparent;
  }

  :host(.scenario-mode) {
    /* Scenario mode class propagated from initBoard; actual color is on #board-area */
  }

  /* Swimlane background band — coloured translucent strip spanning full board width */
  .swimlane-band {
    position: absolute;
    left: 0;
    right: 0;
    pointer-events: none;
    box-sizing: border-box;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }

  /*
   * Sticky label column — stays at the left edge of the viewport while the user
   * scrolls the timeline horizontally, but scrolls vertically with the board.
   *
   * Only "left: 0" is specified (no "top") so stickiness applies in the horizontal
   * direction only. Adding "top: 0" would pin the container to the viewport top,
   * making absolute children appear at fixed viewport positions instead of their
   * correct board positions.
   *
   * height:0 + overflow:visible means the container occupies no vertical space in
   * the flow but its absolutely-positioned children are still rendered over the board.
   */
  .swimlane-labels {
    position: sticky;
    left: 0;
    width: ${SWIMLANE_LABEL_WIDTH_PX}px;
    height: 0;
    overflow: visible;
    z-index: 20;
    pointer-events: none;
  }

  .swimlane-label-slot {
    position: absolute;
    left: 0;
    width: ${SWIMLANE_LABEL_WIDTH_PX}px;
    overflow: visible;
  }

  /* Individual plan/team name label */
  .swimlane-label {
    position: sticky;
    left: 0;
    top: calc(var(--swimlane-label-sticky-top, 24px) + 6px);
    width: ${SWIMLANE_LABEL_WIDTH_PX}px;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    padding: 6px 8px 6px 10px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: rgba(255, 255, 255, 0.9);
    box-sizing: border-box;
    border-left: 4px solid;
    /* Semi-transparent dark background for legibility over the board stripes */
    background: rgba(0, 0, 0, 0.22);
    backdrop-filter: blur(2px);
    transform: translateY(calc(-50% + 15px));
    pointer-events: auto;
  }

  .swimlane-label-text {
    min-width: 0;
    flex: 1 1 auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .swimlane-origin-indicator {
    flex: 0 0 auto;
    padding: 1px 5px;
    border-radius: 999px;
    font-size: 0.62rem;
    line-height: 1.2;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.22);
    cursor: help;
    pointer-events: auto;
  }

  .swimlane-origin-wrap {
    position: static;
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    pointer-events: auto;
  }

  .swimlane-origin-tooltip {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    display: none;
    min-width: 170px;
    max-width: 280px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(25, 26, 30, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(4px);
    z-index: 40;
    pointer-events: auto;
  }

  .swimlane-origin-wrap:hover .swimlane-origin-tooltip,
  .swimlane-origin-wrap:focus-within .swimlane-origin-tooltip {
    display: block;
  }

  .swimlane-origin-item {
    display: flex;
    align-items: center;
    gap: 7px;
    color: rgba(255, 255, 255, 0.92);
    font-size: 0.68rem;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .swimlane-origin-item + .swimlane-origin-item {
    margin-top: 4px;
  }

  .swimlane-origin-swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    box-sizing: border-box;
    flex: 0 0 auto;
  }

  .swimlane-origin-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Expanded-plan labels (unselected projects pulled in by expansion) are dimmer */
  .swimlane-label.type-expanded-plan {
    opacity: 0.75;
    font-weight: 600;
  }

  /* Team labels use italic to distinguish them from plan labels */
  .swimlane-label.type-team {
    font-style: italic;
  }

  /* ---- Group pill ---- */

  /*
`;
