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
    sel.scope.getFunnel = () => ({
      baseTasks: 4,
      relatedTasks: 3,
      tasksInScope: 7,
      teamsInScope: 3,
      tasksVisible: 5,
      teamsInView: 2,
    });
    menu.funnel = sel.scope.getFunnel();
    menu.requestUpdate();
    await menu.updateComplete;

    const root = menu.shadowRoot || menu;
    const summary = root.querySelector('#dataFunnelSummary');
    expect(summary.textContent).to.include('7');
    expect(summary.textContent).to.include('3');
    expect(summary.textContent).to.include('5');
    expect(summary.querySelector('[title="Tasks included in the selected plan scope before display filters"]')).to.exist;
    expect(summary.querySelector('[title="Participating teams allocated to tasks in the selected plan scope"]')).to.exist;
    expect(summary.querySelector('[title="Tasks currently displayed after team focus and task filters"]')).to.exist;
    expect(summary.classList.contains('data-funnel-status')).to.equal(true);
    expect(summary.parentElement.classList.contains('menu-right')).to.equal(true);
    expect(root.querySelector('#teamMenuBtn')).to.equal(null);
    sel.scope.getFunnel = originalGetFunnel;
  });

  it('includes Scope as the related-work menu and reports base and related work', async () => {
    menu.funnel = {
      baseTasks: 5,
      relatedTasks: 2,
      tasksInScope: 7,
      teamsInScope: 3,
      tasksVisible: 7,
      teamsInView: 3,
    };
    menu.requestUpdate();
    await menu.updateComplete;

    const root = menu.shadowRoot || menu;
    expect(root.querySelector('#scopeMenuBtn')).to.exist;
    expect(root.querySelector('#dataFunnelSummary').textContent)
      .to.include('7');
  });

  it('shows active Scope relationship icons in the top menu', async () => {
    menu.scopeContext = { parent: true, child: false, dependency: true, otherAllocations: false };
    menu.requestUpdate();
    await menu.updateComplete;

    const root = menu.shadowRoot || menu;
    expect(root.querySelector('#scopeMenuBtn').textContent).to.include('↑');
    expect(root.querySelector('#scopeMenuBtn').textContent).to.include('↔');
  });
});