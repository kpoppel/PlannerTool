import { expect } from '@esm-bundle/chai';
import '../../www/js/components/Sidebar.lit.js';
import { state } from '../../www/js/services/State.js';

describe('app-sidebar', () => {
  let sidebar;
  beforeEach(() => {
    sidebar = document.createElement('app-sidebar');
    document.body.appendChild(sidebar);
  });

  afterEach(() => {
    if (sidebar) sidebar.remove();
  });
  it('renders Data Funnel section', async () => {
    await sidebar.requestUpdate();
    const html =
      (sidebar.shadowRoot ? sidebar.shadowRoot.innerHTML : sidebar.innerHTML) || '';
    expect(html).to.include('Data Funnel');
    expect(html).to.include('Selected');
  });
});
