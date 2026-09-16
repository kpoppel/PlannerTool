import { expect } from '@open-wc/testing';
import '../../www/js/components/ScopeMenu.lit.js';
import { cmd, sel } from '../../www/js/application/imports.js';

describe('ScopeMenu', () => {
  let menu;

  beforeEach(async () => {
    await customElements.whenDefined('scope-menu');
    menu = document.createElement('scope-menu');
    document.body.appendChild(menu);
    await menu.updateComplete;
  });

  afterEach(() => {
    if (menu && menu.isConnected) menu.remove();
  });

  it('renders related-work options with their additions and scope summary', async () => {
    const originalGetContext = sel.view.getContext;
    sel.view.getContext = () => ({
      parent: false,
      child: true,
      dependency: false,
      otherAllocations: false,
    });
    menu.scopeSummary = { baseTasks: 12, relatedTasks: 9, visibleTasks: 21 };
    menu.optionCounts = { parent: 3, child: 9, dependency: 4, otherAllocations: 7 };
    menu.requestUpdate();
    await menu.updateComplete;

    const root = menu.shadowRoot || menu;
    expect(root.textContent).to.include('Ancestors');
    expect(root.textContent).to.include('Descendant work');
    expect(root.textContent).to.include('Dependencies');
    expect(root.textContent).to.include('Other work by participating teams');
    expect(root.textContent).to.include('+9');
    expect(root.textContent).to.include('12 base + 9 related = 21 shown');
    sel.view.getContext = originalGetContext;
  });

  it('writes the selected Scope option through the context command', () => {
    const originalSetContext = cmd.view.setContext;
    let receivedContext;
    cmd.view.setContext = (context) => { receivedContext = context; };
    menu.context = { parent: false, child: false, dependency: false, otherAllocations: false };

    menu._toggleContext('parent');

    expect(receivedContext).to.deep.equal({
      parent: true,
      child: false,
      dependency: false,
      otherAllocations: false,
    });
    cmd.view.setContext = originalSetContext;
  });
});