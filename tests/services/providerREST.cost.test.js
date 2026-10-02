import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST cost endpoints', () => {
  it('rejects malformed and legacy payloads before making a request', async () => {
    const pr = new ProviderREST();
    let requestCount = 0;
    pr._requestJson = async () => {
      requestCount += 1;
      return { ok: true, data: {} };
    };

    const malformedPayloads = [undefined, null, [], {}, { overrides: [] }, { features: null }];
    for (const payload of malformedPayloads) {
      let error;
      try {
        await pr.getCost(payload);
      } catch (caught) {
        error = caught;
      }
      expect(error).to.be.instanceOf(TypeError);
    }
    expect(requestCount).to.equal(0);
  });

  it('posts a valid features payload to the feature cost endpoint', async () => {
    const pr = new ProviderREST();
    const payload = {
      features: [
        { id: '100', start: '2026-01-01', end: '2026-02-01', capacity: [] },
      ],
    };
    const result = { ok: true, data: { projects: [], months: [], teams: [] } };
    let request;
    pr._requestJson = async (url, options) => {
      request = { url, options };
      return result;
    };

    const cost = await pr.getCost(payload);
    expect(request.url).to.equal('/api/cost/features');
    expect(request.options.method).to.equal('POST');
    expect(request.options.headers['Content-Type']).to.equal('application/json');
    expect(request.options.body).to.equal(JSON.stringify(payload));
    expect(cost).to.equal(result);
  });

  it('getCost(payload) with empty features array returns minimal schema', async () => {
    const pr = new ProviderREST();
    const payload = { features: [] };
    let requestCount = 0;
    pr._requestJson = async () => {
      requestCount += 1;
      return { ok: true, data: {} };
    };

    const cost = await pr.getCost(payload);
    expect(cost.ok).to.equal(true);
    expect(cost.data).to.deep.equal({ projects: [], months: [], teams: [] });
    expect(requestCount).to.equal(0);
  });

  it('returns canonical request failures unchanged', async () => {
    const pr = new ProviderREST();
    const failure = { ok: false, error: { message: 'network unavailable' } };
    pr._requestJson = async () => failure;

    const cost = await pr.getCost({ features: [{ id: '100' }] });
    expect(cost).to.equal(failure);
  });
});
