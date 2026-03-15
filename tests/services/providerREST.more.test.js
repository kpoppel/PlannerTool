import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';
import { bus } from '../../www/js/core/EventBus.js';
import { SessionEvents } from '../../www/js/core/EventRegistry.js';

describe('ProviderREST more branches', () => {
  let prov;
  beforeEach(() => {
    prov = new ProviderREST();
    // ensure clean state
    prov.sessionId = null;
  });

  it('getCost handles GET, array and object payloads', async () => {
    const origFetch = window.fetch;
    // GET
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ get: true }) });
    let res = await prov.getCost();
    expect(res.get).to.equal(true);

    // array payload
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ arr: true }) });
    res = await prov.getCost([{ id: 'x' }]);
    expect(res.arr).to.equal(true);

    // object payload
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ obj: true }) });
    res = await prov.getCost({ features: [] });
    expect(res.obj).to.equal(true);

    // error path
    window.fetch = async () => ({ ok: false, status: 500 });
    try{
      await prov.getCost();
    }catch(e){ expect(e).to.be.instanceOf(Error); }

    window.fetch = origFetch;
  }).timeout(5000);

  it('invalidateCache returns ok on success and error object on failure', async () => {
    const origFetch = window.fetch;
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    let r = await prov.invalidateCache();
    expect(r.ok).to.equal(true);

    window.fetch = async () => { throw new Error('boom'); };
    r = await prov.invalidateCache();
    expect(r.ok).to.equal(false);

    window.fetch = origFetch;
  });

  it('getHistory returns tasks and handles invalid responses', async () => {
    const origFetch = window.fetch;
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ tasks: [1,2,3] }) });
    let r = await prov.getHistory('proj1');
    expect(Array.isArray(r.tasks)).to.equal(true);

    window.fetch = async () => ({ ok: false, status: 500 });
    r = await prov.getHistory('proj1');
    expect(r).to.have.property('tasks');

    window.fetch = origFetch;
  });

  it('view APIs list/get/save/rename/delete handle expected flows', async () => {
    const origFetch = window.fetch;
    // listViews
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ([{ id: 'v1' }]) });
    let list = await prov.listViews();
    expect(Array.isArray(list)).to.equal(true);

    // getView
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'v1' }) });
    let v = await prov.getView('v1');
    expect(v.id).to.equal('v1');

    // saveView
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    let saved = await prov.saveView({ id: 'v1', name: 'X' });
    expect(saved).to.be.an('object');

    // renameView -> relies on getView then save
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    let renamed = await prov.renameView('v1', 'New');
    expect(renamed).to.be.an('object');

    // deleteView
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    let d = await prov.deleteView('v1');
    expect(d).to.equal(true);

    window.fetch = origFetch;
  });

  it('_handleSessionExpiry returns false when acquireSession throws and emits SessionEvents.EXPIRED', async () => {
    const origAcquire = prov.acquireSession;
    prov.acquireSession = async () => { throw new Error('nope'); };
    let emitted = false;
    const origEmit = bus.emit;
    bus.emit = (ev) => { if(ev === SessionEvents.EXPIRED) emitted = true; };
    const r = await prov._handleSessionExpiry();
    expect(r).to.equal(false);
    expect(emitted).to.equal(true);
    // restore
    prov.acquireSession = origAcquire;
    bus.emit = origEmit;
  });

  it('throws from removed helpers to ensure callers get errors', async () => {
    await prov.setFeatureField().then(() => { throw new Error('expected rejection'); }).catch(e => expect(String(e)).to.include('removed'));
    await prov.batchSetFeatureDates().then(() => { throw new Error('expected rejection'); }).catch(e => expect(String(e)).to.include('removed'));
    await prov.setFeatureDates().then(() => { throw new Error('expected rejection'); }).catch(e => expect(String(e)).to.include('removed'));
  });
});
