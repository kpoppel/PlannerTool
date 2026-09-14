import { expect } from '@open-wc/testing';
import '../../www/js/components/TopMenu.lit.js';
import { sel } from '../../www/js/application/imports.js';

describe('TopMenu Data Funnel', () => {
  let menu;

  beforeEach(async () => {
    await customElements.whenDefined('top-menu-bar');
    menu = document.createElement('top-menu-bar');
    document.body.appendChild(menu);
    await menu.updateComplete;
  });

  afterEach(() => {
    if (menu && menu.isConnected) menu.remove();
  });

  it('renders canonical funnel metrics instead of a Team trigger', async () => {
    const originalGetFunnel = sel.scope.getFunnel;
    sel.scope.getFunnel = () => ({ tasksVisible: 7, teamsInView: 3 });
    menu.funnel = sel.scope.getFunnel();
    menu.requestUpdate();
    await menu.updateComplete;

    const root = menu.shadowRoot || menu;
    const summary = root.querySelector('#dataFunnelSummary');
    expect(summary.textContent).to.include('Tasks visible: 7');
    expect(summary.textContent).to.include('Teams in view: 3');
    expect(summary.classList.contains('data-funnel-status')).to.equal(true);
    expect(summary.parentElement.classList.contains('menu-right')).to.equal(true);
    expect(root.querySelector('#teamMenuBtn')).to.equal(null);
    sel.scope.getFunnel = originalGetFunnel;
  });
});