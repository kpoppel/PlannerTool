/**
 * boardCoordinateService.test.js
 * Unit tests for BoardCoordinateService
 */
import { expect } from '@esm-bundle/chai';
import { boardCoords } from '../../www/js/services/BoardCoordinateService.js';
import { _resetTimelineState } from '../../www/js/components/Timeline.lit.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a minimal mock element with a getBoundingClientRect stub.
 */
function mockEl(rect) {
  return {
    getBoundingClientRect: () => ({ ...rect }),
    addEventListener: () => {},
    removeEventListener: () => {},
    scrollLeft: rect.scrollLeft ?? 0,
    scrollTop: rect.scrollTop ?? 0,
  };
}

// Reset boardCoords after each test so nothing leaks between cases
function resetCoords() {
  boardCoords._scrollContainer = null;
  boardCoords._boardArea = null;
  boardCoords._panningAllowed = true;
  boardCoords._subscribers = new Set();
}

// ============================================================================
// Tests
// ============================================================================

describe('BoardCoordinateService', () => {
  afterEach(() => {
    resetCoords();
  });

  // --------------------------------------------------------------------------
  // init / scroll accessors
  // --------------------------------------------------------------------------

  describe('init and scroll state', () => {
    it('scrollX/scrollY return 0 before init', () => {
      expect(boardCoords.scrollX).to.equal(0);
      expect(boardCoords.scrollY).to.equal(0);
    });

    it('scrollX/scrollY reflect scrollLeft/scrollTop after init', () => {
      const sc = mockEl({ left: 0, top: 0, right: 800, bottom: 600, scrollLeft: 120, scrollTop: 40 });
      sc.scrollLeft = 120;
      sc.scrollTop = 40;
      const ba = mockEl({ left: 0, top: 50, right: 800, bottom: 600 });
      boardCoords.init(sc, ba);
      expect(boardCoords.scrollX).to.equal(120);
      expect(boardCoords.scrollY).to.equal(40);
    });
  });

  // --------------------------------------------------------------------------
  // panningAllowed
  // --------------------------------------------------------------------------

  describe('setPanningAllowed', () => {
    it('defaults to true', () => {
      expect(boardCoords.panningAllowed).to.equal(true);
    });

    it('can be set to false and back', () => {
      boardCoords.setPanningAllowed(false);
      expect(boardCoords.panningAllowed).to.equal(false);
      boardCoords.setPanningAllowed(true);
      expect(boardCoords.panningAllowed).to.equal(true);
    });

    it('coerces truthy/falsy values', () => {
      boardCoords.setPanningAllowed(0);
      expect(boardCoords.panningAllowed).to.equal(false);
      boardCoords.setPanningAllowed(1);
      expect(boardCoords.panningAllowed).to.equal(true);
    });
  });

  // --------------------------------------------------------------------------
  // boardToScreen / screenToBoard
  // --------------------------------------------------------------------------

  describe('boardToScreen and screenToBoard', () => {
    it('boardToScreen returns identity when not initialised', () => {
      const result = boardCoords.boardToScreen(10, 20);
      expect(result.x).to.equal(10);
      expect(result.y).to.equal(20);
    });

    it('boardToScreen offsets by boardArea rect', () => {
      const sc = mockEl({ left: 0, top: 0, right: 800, bottom: 600 });
      const ba = mockEl({ left: 100, top: 50, right: 900, bottom: 650 });
      boardCoords.init(sc, ba);
      const { x, y } = boardCoords.boardToScreen(30, 10);
      expect(x).to.equal(130); // 100 + 30
      expect(y).to.equal(60);  // 50 + 10
    });

    it('screenToBoard is the inverse of boardToScreen', () => {
      const sc = mockEl({ left: 0, top: 0, right: 800, bottom: 600 });
      const ba = mockEl({ left: 75, top: 25, right: 875, bottom: 625 });
      boardCoords.init(sc, ba);

      const bx = 200;
      const by = 150;
      const screen = boardCoords.boardToScreen(bx, by);
      const back = boardCoords.screenToBoard(screen.x, screen.y);
      expect(back.x).to.equal(bx);
      expect(back.y).to.equal(by);
    });

    it('screenToBoard returns identity when not initialised', () => {
      const result = boardCoords.screenToBoard(50, 60);
      expect(result.x).to.equal(50);
      expect(result.y).to.equal(60);
    });
  });

  // --------------------------------------------------------------------------
  // isScreenPointInBoard
  // --------------------------------------------------------------------------

  describe('isScreenPointInBoard', () => {
    it('returns false when not initialised', () => {
      expect(boardCoords.isScreenPointInBoard(10, 10)).to.equal(false);
    });

    it('returns true when point is inside boardArea rect', () => {
      const sc = mockEl({ left: 0, top: 0, right: 800, bottom: 600 });
      const ba = mockEl({ left: 100, top: 50, right: 700, bottom: 550 });
      boardCoords.init(sc, ba);
      expect(boardCoords.isScreenPointInBoard(400, 300)).to.equal(true);
    });

    it('returns false when point is outside boardArea rect', () => {
      const sc = mockEl({ left: 0, top: 0, right: 800, bottom: 600 });
      const ba = mockEl({ left: 100, top: 50, right: 700, bottom: 550 });
      boardCoords.init(sc, ba);
      expect(boardCoords.isScreenPointInBoard(50, 300)).to.equal(false);  // left of board
      expect(boardCoords.isScreenPointInBoard(750, 300)).to.equal(false); // right of board
      expect(boardCoords.isScreenPointInBoard(400, 10)).to.equal(false);  // above board
      expect(boardCoords.isScreenPointInBoard(400, 600)).to.equal(false); // below board
    });
  });

  // --------------------------------------------------------------------------
  // subscribe / unsubscribe
  // --------------------------------------------------------------------------

  describe('subscribe', () => {
    it('subscribe returns an unsubscribe function', () => {
      const unsub = boardCoords.subscribe(() => {});
      expect(typeof unsub).to.equal('function');
      unsub();
    });

    it('subscriber is called when _onScroll fires', () => {
      let calls = 0;
      const sc = mockEl({ left: 0, top: 0, right: 800, bottom: 600, scrollLeft: 0, scrollTop: 0 });
      const ba = mockEl({ left: 0, top: 0, right: 800, bottom: 600 });
      boardCoords.init(sc, ba);

      const unsub = boardCoords.subscribe(() => calls++);
      boardCoords._onScroll();
      expect(calls).to.equal(1);
      boardCoords._onScroll();
      expect(calls).to.equal(2);
      unsub();
      boardCoords._onScroll();
      expect(calls).to.equal(2); // no longer called after unsub
    });
  });

  // --------------------------------------------------------------------------
  // dateToContentX / contentXToDateMs
  // --------------------------------------------------------------------------

  describe('dateToContentX and contentXToDateMs', () => {
    before(() => {
      // Set up a minimal set of months via initTimeline
      _resetTimelineState?.();
    });

    it('returns 0 when months list is empty', () => {
      _resetTimelineState?.();
      expect(boardCoords.dateToContentX(new Date('2024-01-15'))).to.equal(0);
    });

    it('contentXToDateMs returns a fallback timestamp when months list is empty', () => {
      _resetTimelineState?.();
      // When no months are loaded, the service returns Date.now() as a safe fallback
      const ts = boardCoords.contentXToDateMs(0);
      expect(typeof ts).to.equal('number');
      expect(ts).to.be.greaterThan(0);
    });
  });
});
