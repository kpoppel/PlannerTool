import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/history tests', () => {
  it('getHistory returns a history object (may be empty)', async () => {
    const pr = new ProviderREST();

    // request history for a specific project with small page size
    const res = await pr.getHistory('project-a', { per_page: 10 });
    expect(res).to.be.an('object');
    expect(res).to.have.property('tasks');
    expect(Array.isArray(res.tasks)).to.equal(true);
    expect(res).to.have.property('page');
    expect(res).to.have.property('per_page');
    expect(res.per_page).to.equal(10);

    // Accept empty history as valid; if non-empty validate shape
    if (res.tasks.length > 0) {
      const entry = res.tasks[0];
      expect(entry).to.have.property('task_id');
      expect(entry).to.have.property('title');
      expect(entry).to.have.property('history');
      expect(Array.isArray(entry.history)).to.equal(true);
      if (entry.history.length > 0) {
        const h = entry.history[0];
        expect(h).to.have.property('field');
        expect(h).to.have.property('changed_at');
        expect(h).to.have.property('changed_by');
      }
    }
  });

  it('getHistory with no project uses defaults', async () => {
    const pr = new ProviderREST();
    const res = await pr.getHistory();
    expect(res).to.be.an('object');
    expect(res).to.have.property('tasks');
    expect(res).to.have.property('per_page');
    expect(res.per_page).to.equal(500);
  });
});
