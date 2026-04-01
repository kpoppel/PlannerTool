import { bus } from './core/EventBus.js';
import { state } from './services/State.js';
import { initDependencyRenderer } from './components/DependencyRenderer.lit.js';
import { featureFlags } from './config.js';
import { pluginManager } from './core/PluginManager.js';
import { registerCoreServices } from './core/ServiceRegistry.js';
import { AppEvents, SessionEvents } from './core/EventRegistry.js';

async function init() {
  registerCoreServices();
  // Register typed events and optional runtime behaviors
  if (featureFlags.LOG_STRING_EVENTS) {
    bus.enableStringWarnings();
  }
  if (featureFlags.LOG_EVENT_HISTORY) {
    bus.enableHistoryLogging(1000);
  }

  // Show a Spinner during init
  await import('./components/SpinnerModal.js');
  const spinner = document.getElementById('appSpinner');
  const showModal = () => {
    if (spinner) {
      spinner.message = 'Loading';
      spinner.open = true;
    }
  };
  const hideModal = () => {
    if (spinner) {
      spinner.open = false;
    }
  };
  showModal();

  try {
    // TODO/DEBUG: For Debugging: Expose internals for automated tests and debugging
    // window.state = state; window.bus = bus;

    const mod = await import('./components/Sidebar.lit.js');
    await mod.initSidebar();

    // Load top menu bar component so the <top-menu-bar> element in index.html upgrades
    await import('./components/TopMenu.lit.js');

    // Ensure TimelineBoard is registered so the element in index.html is upgraded
    await import('./components/TimelineBoard.lit.js');

    // Ensure card component is registered (no board init here anymore)
    // TODO: The featureboard must import this component itself
    await import('./components/FeatureCard.lit.js');

    // Initialize the details panel by importing the Lit component and ensuring a host exists.
    await import('./components/DetailsPanel.lit.js');
    const host = document.createElement('details-panel');
    document.body.appendChild(host);

    // Preload Lit-based color popover to avoid runtime race in tests
    await import('./components/ColorPopover.lit.js');

    // Prefetch lightweight modal helpers during idle to improve perceived performance
    import('./components/modalHelpers.js');

    //Populate the app state from backend
    const { dataService } = await import('./services/dataService.js');
    await dataService.init();
    await state.initState();
    initDependencyRenderer();

    // Load Plugin system
    if (featureFlags.USE_PLUGIN_SYSTEM) {
      // Load modules config via fetch to avoid JSON module import and
      // potential strict MIME-type handling by some dev servers/browsers.
      // Plugin registration is driven entirely by modules.config.json
      const url = new URL('./modules.config.json', import.meta.url).href;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch modules config: ${res.status}`);
      const cfg = await res.json();

      await pluginManager.loadFromConfig(cfg);
      console.log('[App] PluginManager loaded modules');
    }

    // Initialize complete
    hideModal();
    bus.emit(AppEvents.READY);
    // Auto-show onboarding modal on first run when user hasn't dismissed it
    const seen = localStorage.getItem('az_planner:onboarding_seen');
    if (!seen) {
      await import('./components/OnboardingModal.lit.js');
      const em = document.createElement('onboarding-modal');
      document.body.appendChild(em);
    }

    // Session expiry handling: notify user and indicate when reacquired
    const showSpinnerMessage = (msg) => {
      const sp = document.getElementById('appSpinner');
      sp.message = msg || 'Loading';
      sp.open = true;
    };
    const hideSpinner = (delay = 0) => {
      const sp = document.getElementById('appSpinner');
      if (delay) setTimeout(() => (sp.open = false), delay);
      else sp.open = false;
    };

    bus.on(SessionEvents.EXPIRED, (p) => {
      const msg = p?.message || 'Session expired — attempting to re-acquire...';
      showSpinnerMessage(msg);
    });

    bus.on(SessionEvents.REACQUIRED, (p) => {
      if (p && p.ok === false) {
        const msg = 'Session re-acquire failed: ' + (p.error || 'unknown');
        showSpinnerMessage(msg);
        // hide after a short delay so user can read the failure
        hideSpinner(4000);
      } else {
        const msg = (p && p.message) || 'Session re-acquired — Please retry the action.';
        showSpinnerMessage(msg);
        // keep the spinner visible longer so user sees the retry instruction
        hideSpinner(6000);
      }
    });

    // Register global shortcut for in-app search: Ctrl+Shift+F
    // Prevent browser default on keydown so the find UI doesn't steal focus
    document.addEventListener('keydown', (e) => {
      const isCtrlShiftF = (e.key === 'F' || e.key === 'f') && e.ctrlKey && e.shiftKey;
      if (!isCtrlShiftF) return;
      // Only handle when document/app has focus
      if (!document.hasFocus()) return;
      // Prevent triggering browser find only when our app is focused
      e.preventDefault();
      let st = document.querySelector('search-tool');
      if (!st) {
        import('./components/SearchTool.lit.js')
          .then(() => {
            st = document.createElement('search-tool');
            document.body.appendChild(st);
            // schedule open so rendering/focus is not impacted by the key event
            setTimeout(() => st.open(), 0);
          })
          .catch(console.warn);
      } else {
        st.open();
      }
    });
  } catch (e) {
    // Something really bad happened during app initialisaition. Log and show error message to user.
    hideModal();
    console.error(e);
    throw e;
  }
}

window.addEventListener('DOMContentLoaded', init);
