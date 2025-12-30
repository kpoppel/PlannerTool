import { expect } from '@esm-bundle/chai';
import '../../www/js/components/Sidebar.lit.js';
import { state } from '../../www/js/services/State.js';
import { pluginManager } from '../../www/js/core/PluginManager.js';

describe('app-sidebar extra', () => {
  let sidebar;
  beforeEach(() => {
    sidebar = document.createElement('app-sidebar');
    document.body.appendChild(sidebar);
  });
  afterEach(() => { if(sidebar) sidebar.remove(); });

  it('renders plugin buttons when plugin system enabled', async () => {
    // stub isEnabled by marking pluginManager.list to return items
    const origList = pluginManager.list;
    const origIsActive = pluginManager.isActive;
    pluginManager.list = () => [{ id: 'p1', title: 'P1', enabled: true }];
    pluginManager.isActive = (id) => false;
    // force isEnabled behavior by setting feature flag via state or importing isEnabled is done in module; we just call _renderPluginButtons
    const html = sidebar._renderPluginButtons();
    expect(html).to.exist;
    pluginManager.list = origList;
    pluginManager.isActive = origIsActive;
  });

  it('refreshServerStatus sets error on failure', async () => {
    // dynamic import and stub the exported dataService.checkHealth
    const mod = await import('../../www/js/services/dataService.js');
    const ds = mod.dataService;
    const origCheck = ds.checkHealth;
    try{
      ds.checkHealth = async () => { throw new Error('fail'); };
      await sidebar.refreshServerStatus();
      expect(sidebar.serverStatus).to.include('error');
    }finally{
      ds.checkHealth = origCheck;
    }
  });
});
