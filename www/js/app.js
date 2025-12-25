import { bus } from './core/EventBus.js';
import { state } from './services/State.js';
import { initDependencyRenderer } from './components/DependencyRenderer.lit.js';
import { featureFlags } from './config.js';
import { pluginManager } from './core/PluginManager.js';
import { registerCoreServices } from './core/ServiceRegistry.js';
import { AppEvents } from './core/EventRegistry.js';

async function init(){
  registerCoreServices();
  // Phase 1: Register typed events and optional runtime behaviors
  try {
    if (featureFlags.LOG_STRING_EVENTS) {
      bus.enableStringWarnings();
    }
    if (featureFlags.LOG_EVENT_HISTORY) {
      bus.enableHistoryLogging(1000);
    }
  } catch (e) { console.warn('[App] Failed to initialize EventRegistry or EventBus flags', e); }
  // Show a Spinner during init
  try { await import('./components/SpinnerModal.js'); } catch (e) { /* ignore */ }
  const spinner = document.getElementById('appSpinner');
  const showModal = () => {
    if(spinner){
      spinner.message = 'Loading';
      spinner.open = true;
    }
  };
  const hideModal = () => {
    if(spinner){
      spinner.open = false;
    }
  };
  showModal();

  try {
    // TODO/DEBUG: For Debugging: Expose internals for automated tests and debugging
    // try{ window.state = state; window.bus = bus; }catch(e){}
    try{
      const mod = await import('./components/Sidebar.lit.js');
      if(mod && mod.initSidebar) await mod.initSidebar();
    }catch(e){ console.warn('Failed to mount Lit sidebar', e); }

    let modFeatureBoard;
    try{
      modFeatureBoard = await import('./components/FeatureBoard.lit.js');
      if (modFeatureBoard && modFeatureBoard.initBoard) await modFeatureBoard.initBoard();
    }catch(e){ console.warn('Failed to load or init feature-board', e); }

    try{
      const mod = await import('./components/Timeline.lit.js');
      if(mod && mod.initTimeline) await mod.initTimeline();
    }catch(e){ console.warn('Failed to init Lit timeline', e); }

    // Ensure card component is registered (no board init here anymore)
    try{ await import('./components/FeatureCard.lit.js'); }catch(e){ console.warn('Failed to load feature-card', e); }
    // Initialize the details panel by importing the Lit component and ensuring a host exists.
    const modDetailsPanel = await import('./components/DetailsPanel.lit.js');
    if(modDetailsPanel){
      // The module defines the custom element; ensure a single host exists in document body
      let host = document.querySelector('details-panel');
      if(!host){ host = document.createElement('details-panel'); document.body.appendChild(host); }
    }
    // Preload Lit-based color popover to avoid runtime race in tests
    try{ await import('./components/ColorPopover.lit.js'); }catch(e){}
    // Ensure MainGraph lit component is loaded and a host instance exists
    try{
      if(!customElements.get('maingraph-lit')){
        await import('./components/MainGraph.lit.js');
      }
      let mg = document.querySelector('maingraph-lit');
      if(!mg){
        const canvas = document.getElementById('mainGraphCanvas');
        const el = document.createElement('maingraph-lit');
        if(canvas && canvas.parentNode){ canvas.parentNode.insertBefore(el, canvas); try{ canvas.style.display = 'none'; }catch(e){} }
        else { const section = document.getElementById('timelineSection'); if(section && section.appendChild) section.appendChild(el); else document.body.appendChild(el); }
        mg = el;
      }
    }catch(e){ console.warn('[App] failed to init maingraph-lit', e); }
    initDependencyRenderer();
    // Prefetch lightweight modal helpers during idle to improve perceived performance
    try{
      if ('requestIdleCallback' in window) requestIdleCallback(()=> import('./components/modalHelpers.js'));
      else setTimeout(()=> import('./components/modalHelpers.js'), 3000);
    }catch(e){ /* ignore prefetch failures */ }
    // Phase 7: Plugin system
    if (featureFlags.USE_PLUGIN_SYSTEM) {
      try {
        let cfg;
        try {
          // Try native JSON module import first (may be blocked by server MIME)
          cfg = await import('./modules.config.json', { assert: { type: 'json' } });
          cfg = cfg.default || cfg;
        } catch (impErr) {
          // Fallback to fetch+json to avoid MIME type restrictions
          try {
            const url = new URL('./modules.config.json', import.meta.url).href;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to fetch modules config: ${res.status}`);
            cfg = await res.json();
          } catch (fetchErr) {
            throw fetchErr || impErr;
          }
        }

        await pluginManager.loadFromConfig(cfg);
        console.log('[App] PluginManager loaded modules');
      } catch (err) {
        console.error('[App] Failed to load plugin modules', err);
      }
    }
    //Populate the app state from backend
    const { dataService } = await import('./services/dataService.js');
    await dataService.init();
    await state.initState();
    try{
      // Let the timeline module manage its own initial scroll behavior
      const mod = await import('./components/Timeline.lit.js');
      if(mod) mod.ensureScrollToMonth();
    }catch(e){ /* ignore */ }
    // Initialize complete
    hideModal();
    bus.emit(AppEvents.READY);
  } catch(e) {
    hideModal();
    throw e;
  }
}

window.addEventListener('DOMContentLoaded', init);
