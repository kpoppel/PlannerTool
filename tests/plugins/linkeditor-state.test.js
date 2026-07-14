import { expect } from '@open-wc/testing';
import {
  ACTIONS,
  getLinkEditorState,
} from '../../www/js/plugins/linkeditor/LinkEditorState.js';

describe('LinkEditorState', () => {
  let editor;

  beforeEach(() => {
    editor = getLinkEditorState();
    editor.clear();
    editor.disable();
  });

  afterEach(() => {
    editor.clear();
    editor.disable();
    editor.setApi(null);
  });

  it('updates relations through PlannerApi without importing State', () => {
    const calls = [];
    editor.setApi({
      features: {
        getById: () => ({ id: 'f1', relations: [{ type: 'Related', id: 'f2' }] }),
        updateRelations: (...args) => {
          calls.push(args);
          return true;
        },
      },
    });
    editor.enable();
    editor.startAction(ACTIONS.SUCCESSOR, 'f1');

    expect(editor.completeAction('f3')).to.equal(true);
    expect(calls).to.deep.equal([
      [
        'f1',
        [
          { type: 'Related', id: 'f2' },
          { type: 'Successor', id: 'f3' },
        ],
      ],
    ]);
    expect(editor.pendingAction).to.equal(null);
  });

  it('removes a relation through PlannerApi', () => {
    const calls = [];
    editor.setApi({
      features: {
        getById: () => ({
          id: 'f1',
          relations: [
            { type: 'Related', id: 'f2' },
            { type: 'Successor', id: 'f3' },
          ],
        }),
        updateRelations: (...args) => {
          calls.push(args);
          return true;
        },
      },
    });

    expect(editor.removeRelation('f1', 'f2', ACTIONS.RELATED)).to.equal(true);
    expect(calls).to.deep.equal([
      ['f1', [{ type: 'Successor', id: 'f3' }]],
    ]);
  });
});