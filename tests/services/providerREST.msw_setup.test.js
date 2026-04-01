/* Prototype for tests using the Mock Service Worker (WSW library
 * This test overrides the default handler for the /api/tasks endpoint to return
 * a specific task.
 */
import { expect } from '@esm-bundle/chai';
import { server } from '../msw/server.js';
import { http, HttpResponse } from 'msw';
import { ProviderREST } from '../../www/js/services/providerREST.js';

const prototask = {
  id: 'T-000',
  type: 'feature',
  title: 'Prototype Task Title',
  assignee: '',
  state: 'New',
  tags: null,
  description: null,
  startDate: null,
  finishDate: null,
  areaPath: 'my_proj\\p1\\p2',
  iterationPath: 'my_proj\\i1',
  relations: [],
  url: 'https://example.com/T-000',
  project: 'project-a',
  start: null, // TODO: Really must remove the double start, startDate, end, endDate mess
  end: null,
  capacity: [],
};

const prototask_2 = {
  id: 'T-001',
  type: 'feature',
  title: 'Prototype Task Title',
  assignee: '',
  state: 'New',
  tags: null,
  description: null,
  startDate: null,
  finishDate: null,
  areaPath: 'my_proj\\p1\\p2',
  iterationPath: 'my_proj\\i1',
  relations: [],
  url: 'https://example.com/T-000',
  project: 'project-a',
  start: null, // TODO: Really must remove the double start, startDate, end, endDate mess
  end: null,
  capacity: [],
};

describe('ProviderREST test checking the MSW implementation with MSW custom scoped handler', () => {
  it('getFeatures returns handler-provided features', async () => {
    server.use(
      http.get('/api/tasks', (req) => {
        //console.log('MSW handler /api/tasks invoked');
        return HttpResponse.json([prototask], {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    const pr = new ProviderREST();
    const out = await pr.getFeatures();
    //console.log('DEBUG getFeatures out =>', out);
    expect(Array.isArray(out)).to.equal(true);
    expect(out[0].id).to.equal('T-000');
  });
});

describe('ProviderREST test checking the MSW implementation with MSW custom full override scoped handler', () => {
  it('getFeatures returns handler-provided features', async () => {
    /* Example - This will remove all handlers and install only this one: */
    server.resetHandlers(
      http.get('/api/tasks', (req, res, ctx) => {
        //console.log('MSW handler /api/tasks invoked');
        return HttpResponse.json([prototask_2], {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );

    const pr = new ProviderREST();
    const out = await pr.getFeatures();
    //console.log('DEBUG getFeatures out =>', out);
    expect(Array.isArray(out)).to.equal(true);
    expect(out[0].id).to.equal('T-001');
  });
});
