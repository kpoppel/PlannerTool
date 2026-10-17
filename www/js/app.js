import { bus } from './core/EventBus.js';
import { featureFlags } from './config.js';
import { pluginManager } from './core/PluginManager.js';
import { AppEvents, SessionEvents } from './core/EventRegistry.js';
import { mergePluginConfig } from './core/pluginConfigMerge.js';
import { initKeyboardShortcuts } from './services/KeyboardShortcuts.js';
import { createUiCommands } from './application/commands/uiCommands.js';
import { DataCommandEvents } from './application/commands/dataCommands.js';
import { store } from './application/store.js';

const uiCommands = createUiCommands(store, bus);

export function registerFailureNotifications() {
  const unsubscribers = [
    bus.on(SessionEvents.EXPIRED, (payload) => {
      uiCommands.addNotification({ source: 'Session', code: 'session_expired',
        severity: 'error', message: payload.message });
    }),
    bus.on(SessionEvents.REACQUIRED, (payload) => {
      const failed = payload.ok === false;
      uiCommands.addNotification({ source: 'Session', code: failed ? 'session_failed' : 'session_recovered',
        severity: failed ? 'error' : 'success',
        message: failed ? `Session renewal failed: ${payload.error}` : payload.message });
    }),
    bus.on(DataCommandEvents.HYDRATION_FAILED, (payload) => {
      uiCommands.addNotification({ source: 'Application', code: 'hydration_failed', severity: 'error',
        message: `Loading ${payload.phase} failed: ${payload.error.message}` });
    }),
  ];
  const onError = (event) => uiCommands.addNotification({
    source: 'Application', code: 'uncaught_error', severity: 'error',
    message: `Unexpected application error: ${event.message}`,
  });
  const onRejection = (event) => uiCommands.addNotification({
    source: 'Application', code: 'unhandled_rejection', severity: 'error',
    message: `Unhandled failure: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`,
  });
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

export async function loadPluginConfiguration(dataService, modulesConfig) {
  const runtimeConfigResult = await dataService.getPluginsConfig();
  if (!runtimeConfigResult.ok) throw new Error(runtimeConfigResult.error.message);

  const pluginSchemasResult = await dataService.getPluginsSchemas();
  if (!pluginSchemasResult.ok) throw new Error(pluginSchemasResult.error.message);

  window.APP_PLUGIN_SCHEMAS = pluginSchemasResult.data;
  return mergePluginConfig(modulesConfig, runtimeConfigResult.data.plugins);
}

async function init() {
  registerFailureNotifications();
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

    // Sidebar must not mount before baseline/scenario/view hydration completes.
    // The initial store is intentionally in bootstrap mode until data is loaded.
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

    // Populate the app state from the backend through the store-backed bootstrap.
    const { dataService } = await import('./services/dataService.js');
    await dataService.init();
    const { showReleaseNotes } = await import('./components/ReleaseNotes.lit.js');
    hideModal();
    await showReleaseNotes(`${window.APP_BASE_URL}/api`);
    showModal();
    const topMenu = document.querySelector('top-menu-bar');
    topMenu.baseUrl = window.APP_BASE_URL;
    await topMenu.loadPermissions();
    const { cmd } = await import('./application/imports.js');
    await cmd.data.hydrateBaseline();
    await cmd.data.initializeAllocationPreferences();
    await cmd.data.hydrateScenarioData();
    await cmd.viewRestore.restoreLastView();
    // View restore updates selection/filter slices; recompute capacity so graph data is fresh.
    cmd.data.recomputeCapacity();

    const mod = await import('./components/Sidebar.lit.js');
    await mod.initSidebar();
    const footer = await import('./components/sidebar/SidebarFooter.lit.js');
    footer.initAppFooter();

    // Load Plugin system
    // Load modules config via fetch to avoid JSON module import and
    // potential strict MIME-type handling by some dev servers/browsers.
    // Plugin registration is driven by modules.config.json merged with
    // admin-persisted runtime config from /api/plugins/config.
    const url = new URL('./modules.config.json', import.meta.url).href;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch modules config: ${res.status}`);
    const cfg = await res.json();

    const mergedCfg = await loadPluginConfiguration(dataService, cfg);
    await pluginManager.loadFromConfig(mergedCfg);
    console.log('[App] PluginManager loaded modules');

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

    await initKeyboardShortcuts();
  } catch (e) {
    // Initialization failures leave the notification log accessible without the loading overlay.
    hideModal();
    console.error(e);
    uiCommands.addNotification({ source: 'Application', code: 'initialization_failed', severity: 'error',
      message: `Initialization failed: ${e instanceof Error ? e.message : String(e)}` });
    throw e;
  }
}

window.addEventListener('DOMContentLoaded', init);
