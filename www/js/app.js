import { initSidebar } from './sidebar.js';
import { initTimeline } from './timeline.js';
import { initFeatureCards } from './featureCard.js';
import { initDetailsPanel } from './detailsPanel.js';
import { initColorManager } from './colorManager.js';
import { bus } from './eventBus.js';
import { state } from './state.js';
import { initmainGraph } from './mainGraph.js';
import { initDependencyRenderer } from './dependencyRenderer.js';

async function init(){
  // Simple loading modal
  const modal = document.getElementById('loading-modal');
  function showModal(){
    if(modal) modal.style.display = 'flex';
  }
  function hideModal(){
    if(modal) modal.style.display = 'none';
  }

  showModal();
  try {
    const { dataService } = await import('./dataService.js');
    await dataService.init();
    await state.initState();
    initSidebar();
    initTimeline();
    initFeatureCards();
    initDetailsPanel();
    initColorManager();
    initmainGraph();
    initDependencyRenderer();
    hideModal();
    bus.emit('app:ready');
  } catch(e) {
    hideModal();
    throw e;
  }
}

window.addEventListener('DOMContentLoaded', init);
