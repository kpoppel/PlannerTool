import { initSidebar } from './sidebar.js';
import { initTimeline } from './timeline.js';
import { initFeatureCards } from './featureCard.js';
import { initDetailsPanel } from './detailsPanel.js';
import { initColorManager } from './colorManager.js';
import { bus } from './eventBus.js';
import { state } from './state.js';
import { initLoadGraph } from './loadGraph.js';

async function init(){
  await state.initState();
  initSidebar();
  initTimeline();
  initFeatureCards();
  initDetailsPanel();
  initColorManager();
  initLoadGraph();

  // Configuration navigation
  bus.on('config:open', ()=>{
    import('./configModal.js').then(mod => {
      mod.openConfigModal();
    });
  });
  bus.emit('app:ready');
}

window.addEventListener('DOMContentLoaded', init);
