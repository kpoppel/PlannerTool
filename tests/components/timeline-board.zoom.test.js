import { expect, fixture, html } from '@open-wc/testing';
import { TimelineBoard } from '../../www/js/components/TimelineBoard.lit.js';

describe('TimelineBoard board zoom', () => {
  it('steps, clamps, and resets board-local zoom', () => {
    const board = new TimelineBoard();

    board.adjustBoardZoom(-1);
    expect(board.boardZoom).to.equal(0.9);

    for (let index = 0; index < 20; index += 1) board.adjustBoardZoom(-1);
    expect(board.boardZoom).to.equal(0.5);

    for (let index = 0; index < 30; index += 1) board.adjustBoardZoom(1);
    expect(board.boardZoom).to.equal(2);

    board.resetBoardZoom();
    expect(board.boardZoom).to.equal(1);
  });

  it('passes board zoom to graph rendering without CSS-scaling the graph', async () => {
    const board = await fixture(html`<timeline-board></timeline-board>`);
    board.adjustBoardZoom(-1);
    await board.updateComplete;

    const graphSection = board.shadowRoot.querySelector('#maingraph-section');
    const graph = graphSection.querySelector('maingraph-lit');
    const boardSurface = board.shadowRoot.querySelector('#board-zoom-surface');

    expect(graphSection.hasAttribute('style')).to.equal(false);
    expect(graph.horizontalScale).to.equal(0.9);
    expect(boardSurface.getAttribute('style')).to.equal('zoom: 0.9');
  });

  it('keeps the content beneath the mouse fixed while zooming', async () => {
    const board = await fixture(html`<timeline-board></timeline-board>`);
    const scrollContainer = board.shadowRoot.querySelector('#scroll-container');
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 800 });
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 600 });
    scrollContainer.getBoundingClientRect = () => ({ left: 200, top: 100 });
    scrollContainer.scrollLeft = 400;
    scrollContainer.scrollTop = 300;

    board.adjustBoardZoom(-1, 500, 450);
    await board.updateComplete;

    expect(board.boardZoom).to.equal(0.9);
    expect(scrollContainer.scrollLeft).to.equal(330);
    expect(scrollContainer.scrollTop).to.equal(235);
  });
});