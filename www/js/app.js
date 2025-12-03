import { initSidebar } from './sidebar.js';
import { initTimeline } from './timeline.js';
import { initFeatureCards } from './featureCard.js';
import { initDetailsPanel } from './detailsPanel.js';
import { initColorManager } from './colorManager.js';
import { bus } from './eventBus.js';
import { state } from './state.js';
import { initLoadGraph } from './loadGraph.js';
import { initDependencyRenderer } from './dependencyRenderer.js';

async function init(){
  // Ensure backend session is created before first API calls
  try { const { dataService } = await import('./dataService.js'); await dataService.init(); } catch {}
  await state.initState();
  initSidebar();
  initTimeline();
  initFeatureCards();
  initDetailsPanel();
  initColorManager();
  initLoadGraph();
  initDependencyRenderer();
  bus.emit('app:ready');
}

window.addEventListener('DOMContentLoaded', init);
