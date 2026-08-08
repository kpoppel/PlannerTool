import { expect } from '@esm-bundle/chai';
import { server } from '../msw/server.js';
import { http, HttpResponse } from 'msw';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/view tests', () => {
  it('list, get, save (twice) and delete views', async () => {
    const pr = new ProviderREST();

    // listViews - uses shared handlers in tests/msw/handlers.js
    const list = await pr.listViews();
    expect(list.ok).to.equal(true);
    expect(Array.isArray(list.data)).to.equal(true);
    expect(list.data.length).to.be.at.least(1);
    // known fixture name from handlers.js
    expect(list.data.some((v) => v.name === 'Team A View')).to.equal(true);

    // getView - request a known fixture id
    const knownId = 'f13cfd50bc464598a833fc385a44d20d';
    const view = await pr.getView(knownId);
    expect(view.ok).to.equal(true);
    expect(view.data).to.not.equal(null);
    expect(view.data.name).to.equal('Team B View');

    // saveView (create) - id is null for new view, server assigns id
    const newView = { ...view.data, id: null, name: 'New View' };
    const saved1 = await pr.saveView(newView);
    expect(saved1.ok).to.equal(true);
    expect(saved1.data).to.have.property('id');
    expect(saved1.data.name).to.equal('New View');

    // saveView (update)
    const saved2 = await pr.saveView({ ...saved1.data, name: 'New View Updated' });
    expect(saved2.ok).to.equal(true);
    expect(saved2.data.id).to.equal(saved1.data.id);
    expect(saved2.data.name).to.equal('New View Updated');

    // deleteView
    const deleted = await pr.deleteView(saved2.data.id);
    expect(deleted.ok).to.equal(true);
    expect(deleted.data).to.equal(true);
  });
});
