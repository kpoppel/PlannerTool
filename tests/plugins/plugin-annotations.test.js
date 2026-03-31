import { expect } from '@open-wc/testing';
import { stub } from 'sinon';
import PluginAnnotations from '../../www/js/plugins/PluginAnnotations.js';
import * as boardUtils from '../../www/js/components/board-utils.js';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginEvents } from '../../www/js/core/EventRegistry.js';

describe('PluginAnnotations', () => {
  let emitStub;
  let findStub;

  beforeEach(() => {
    emitStub = stub(bus, 'emit');
  });

  afterEach(() => {
    emitStub.restore();
    if (findStub) findStub.restore();
  });

  it('activates with board mount and attaches resize handler, then destroys', async () => {
    const board = document.createElement('div');
    board.id = 'feature-board';
    document.body.appendChild(board);
    // Provide an app container fallback
    const app = document.createElement('div');
    app.className = 'app-container';
    document.body.appendChild(app);

    // stub findInBoard to return our board
    findStub = stub(boardUtils, 'findInBoard').callsFake((sel) => board);

    const p = new PluginAnnotations('ann-test', { forceMountInBoard: true });
    p._componentLoaded = true;

    await p.activate();

    expect(p.active).to.be.true;
    expect(emitStub.calledOnce).to.be.true;
    expect(emitStub.firstCall.args[0]).to.equal(PluginEvents.ACTIVATED);

    // element should be appended to board and styled
    expect(p._el).to.exist;
    expect(p._el.style.position).to.equal('absolute');

    // resize handler should be attached
    expect(p._annotationBoardHandlers).to.exist;

    await p.destroy();
    expect(p._el).to.equal(null);
    expect(p._annotationBoardHandlers).to.equal(null);
    expect(p.initialized).to.be.false;
    expect(p.active).to.be.false;

    // cleanup
    app.remove();
    board.remove();
  });
});
