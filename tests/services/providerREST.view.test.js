import { expect } from '@esm-bundle/chai';
import { server } from '../msw/server.js';
import { http, HttpResponse } from 'msw';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/view tests', () => {
  it('list, get, save (twice) and delete views', async () => {
    const pr = new ProviderREST();

    // listViews - uses shared handlers in tests/msw/handlers.js
    const list = await pr.listViews();
    expect(Array.isArray(list)).to.equal(true);
    expect(list.length).to.be.at.least(1);
    // known fixture name from handlers.js
    expect(list.some((v) => v.name === 'Team A View')).to.equal(true);

    // getView - request a known fixture id
    const knownId = 'f13cfd50bc464598a833fc385a44d20d';
    const view = await pr.getView(knownId);
    expect(view).to.not.equal(null);
    expect(view.name).to.equal('Team B View');

    // saveView (create) - id is null for new view, server assigns id
    const newView = { ...view, id: null, name: 'New View' };
    const saved1 = await pr.saveView(newView);
    expect(saved1).to.have.property('id');
    expect(saved1.name).to.equal('New View');

    // saveView (update)
    saved1.name = 'New View Updated';
    const saved2 = await pr.saveView(saved1);
    expect(saved2.id).to.equal(saved1.id);
    expect(saved2.name).to.equal('New View Updated');

    // deleteView
    const ok = await pr.deleteView(saved2.id);
    expect(ok).to.equal(true);
  });
});
