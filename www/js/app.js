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

    // Ensure TimelineBoard is registered so the element in index.html is upgraded
    try{ await import('./components/TimelineBoard.lit.js'); }catch(e){ console.warn('Failed to load timeline-board', e); }

    // FeatureBoard is mounted and initialized by TimelineBoard; ensure module available
    //try{ await import('./components/FeatureBoard.lit.js'); }catch(e){ /* ignore */ }

    // Timeline initialization is handled by TimelineBoard; ensure module available for other consumers
    //try{ await import('./components/Timeline.lit.js'); }catch(e){ /* ignore */ }

    // Ensure card component is registered (no board init here anymore)
    // TODO: The featureboard must import this component itself
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
    // MainGraph is initialized by TimelineBoard; ensure the module is available for other consumers
    //try{ await import('./components/MainGraph.lit.js'); }catch(e){ /* ignore if not available */ }
    initDependencyRenderer();
    // Prefetch lightweight modal helpers during idle to improve perceived performance
    try{
      if ('requestIdleCallback' in window) requestIdleCallback(()=> import('./components/modalHelpers.js'));
      else setTimeout(()=> import('./components/modalHelpers.js'), 3000);
    }catch(e){ /* ignore prefetch failures */ }
    //Populate the app state from backend
    const { dataService } = await import('./services/dataService.js');
    await dataService.init();
    await state.initState();
    // TimelineBoard handles initial scroll behavior

    // Load Plugin system
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
        // Plugin registration is driven entirely by modules.config.json now
      } catch (err) {
        console.error('[App] Failed to load plugin modules', err);
      }
    }

    // Initialize complete
    hideModal();
    bus.emit(AppEvents.READY);
  } catch(e) {
    hideModal();
    throw e;
  }
}

window.addEventListener('DOMContentLoaded', init);
