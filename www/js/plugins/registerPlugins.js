import { isEnabled } from '../config.js';
import { createAndRegister } from './PluginGraph.js';

export async function registerPlugins(){
  if(!isEnabled('USE_PLUGIN_SYSTEM')) return;
  console.log('[PluginManager] Registering plugins...');

  if(isEnabled('ENABLE_PLUGIN_GRAPH')) {
    console.log('[PluginManager] Registering Graph View plugin');
    await createAndRegister({ id: 'plugin-graph', title: 'Graph View', mode: 'project' });
  }
}
