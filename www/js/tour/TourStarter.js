// TourStarter.js - Shepherd-based guided tour starter
// Dynamically loads Shepherd (prefer local vendor) and starts a short tour.

const SHEPHERD_LOCAL = '/static/js/vendor/shepherd.min.js';
const SHEPHERD_CDN = 'https://unpkg.com/shepherd.js@8/dist/js/shepherd.min.js';

async function _loadShepherd(){
  // Try local vendor first
  try{
    await import(SHEPHERD_LOCAL);
    return window.Shepherd || (await import(SHEPHERD_LOCAL)).default;
  }catch(e){
    // Fallback to CDN
    try{ await import(SHEPHERD_CDN); return window.Shepherd || (await import(SHEPHERD_CDN)).default; }catch(err){ throw err; }
  }
}

export async function startTour(){
  const Shepherd = await _loadShepherd();
  if(!Shepherd) throw new Error('Shepherd not available');

  // Basic styling class to match app: reuse app color variables where possible
  const tour = new Shepherd.Tour({ useModalOverlay: true, defaultStepOptions: { classes: 'azplanner-shepherd-step', scrollTo: { behavior: 'smooth', block: 'center' } } });

  // Ensure the View Options sidebar section is expanded so tour can attach to its elements
  try{
    const viewSection = document.getElementById('viewOptionsSection');
    if(viewSection){
      const collapsed = viewSection.querySelector('.sidebar-section-collapsed');
      if(collapsed) collapsed.classList.remove('sidebar-section-collapsed');
      // also update chevron if present
      const header = viewSection.querySelector('.sidebar-section-header-collapsible');
      const chevron = header && header.querySelector('.sidebar-chevron');
      if(chevron) chevron.textContent = '▲';
    }
  }catch(e){ /* ignore if sidebar not present */ }


  // Define tour steps; attach to elements if present now (no waiting) so the
  // tour starts immediately without serial delays.
  const stepDefs = [
    {
      id: 'step-gear', selector: '[data-tour="gear"]', position: 'right', title: 'Configuration',
      text: `Open the configuration here to add your email and PAT (Personal Access Token).<br>
            You can set an autosave interval so your work is saved automatically.`
    },
    {
      id: 'step-sidebar', selector: 'app-sidebar', position: 'right', title: 'Sidebar',
      text: `Use the sidebar to select projects, teams and scenarios, and to access filtering and view options.`
    },
    {
      id: 'step-zoom', selector: '[data-tour="zoom"]', position: 'bottom', title: 'Zoom',
      text: `Zoom controls let you change the time scale of the planner so you can focus on days, weeks or months.`
    },
    {
      id: 'step-condensed', selector: '[data-tour="condensed-view"]', position: 'bottom', title: 'Condensed View',
      text: `Toggle condensed view to see more features at once.`
    },
    {
      id: 'step-dependency-renderer', selector: '[data-tour="dependency-renderer"]', position: 'bottom', title: 'Dependencies',
      text: `Toggle dependency rendering to visualize relationships between features.`
    },
    {
      id: 'step-unassigned', selector: '[data-tour="unassigned-view"]', position: 'bottom', title: 'Unassigned Features',
      text: `Toggle to show or hide features that have not been assigned capacity to any team.`
    },
    {
      id: 'step-unplanned', selector: '[data-tour="unplanned-view"]', position: 'bottom', title: 'Unplanned Work',
      text: `Toggle to show or hide unplanned work items in the timeline. Unplanned work items are those without start and end dates.`
    },
    {
      id: 'step-capacity', selector: '[data-tour="capacity-view"]', position: 'bottom', title: 'Capacity View',
      text: `Use the capacity view buttons to see team capacity data or sums of capacity per plan.`
    },
    {
      id: 'step-sort', selector: '[data-tour="sort-view"]', position: 'bottom', title: 'Sort Features',
      text: `Use sorting to order features by rank or date.`
    },
    {
      id: 'step-tasktypes', selector: '[data-tour="tasktypes-view"]', position: 'bottom', title: 'Task Types',
      text: `Use task type filters to show or hide Epics and Features.`
    },
    {
      id: 'step-state-filters', selector: '[data-tour="state-filters"]', position: 'bottom', title: 'State Filters',
      text: `Use filters to limit visible features by the task state.`
    },
    {
      id: 'step-planning', selector: '[data-tour="planning"]', position: 'bottom', title: 'Planning',
      text: `Select which tasks to focus on in the planning view. The view is divided with project delivery tasks on top and team backlogs below.`
    },
    {
      id: 'step-allocations', selector: '[data-tour="allocations"]', position: 'bottom', title: 'Allocations View',
      text: `Toggle allocations view to see team assignments on the timeline.`
    },
    {
      id: 'step-scenarios', selector: '[data-tour="scenarios"]', position: 'bottom', title: 'Scenarios',
      text: `Use scenarios to create different planning scenarios and compare them.`
    },
    {
      id: 'step-tools', selector: '[data-tour="tools"]', position: 'bottom', title: 'Tools',
      text: `Tools are extensions enabled via plugins. Here you can find tools for graph viewing, exporting and more.`
    },
    {
      id: 'step-timeline', selector: 'timeline-board', position: 'top', title: 'Timeline',
      text: `This is the timeline view showing features and allocations. Try changing zoom levels and applying filters.`
    },
    {
      id: 'step-feature', selector: '[data-tour="feature-card"]', position: 'right', title: 'Feature card',
      text: `Feature cards show the task type, title and assigned dates if any.
            The top part shows any allocation of capacity to the feature. If the allocation bar is dimmed it is because
            the card has children.  The working principle of the application is to assume a card with children has better estimates
            from the children.  If the cost plugin is enabled, the Epic estimates are used to flag possible budget issues.
            Click a feature card to open the task details.
            `
    },
    // Single Details panel tour step (consolidated)
    {
      id: 'step-details', selector: '[data-tour="details-panel"]', position: 'left', title: 'Details Panel',
      text: `This panel shows detailed information about the selected feature:<br>
            assignee, dates, capacity allocations per team, description and related links.<br>
            Use the capacity controls to edit team allocations or add a team; changes are
            stored in the active scenario. Use the close button or click anywhere else to hide the panel.`
    },
    {
      id: 'step-help', selector: '[data-tour="help"]', position: 'left', title: 'Help & Docs',
      text: `Open help to read docs, view keyboard shortcuts, or replay the tour. Thanks for getting to the end.`
    }
  ];

  for(let i=0;i<stepDefs.length;i++){
    const s = stepDefs[i];
    // Check for element presence now; do not wait — fall back to centered step
    const el = document.querySelector(s.selector);
    const buttons = [];
    // Add an Exit button to allow users to end the tour early
    buttons.push({ text: 'End tour', action: tour.cancel, classes: 'shepherd-button-secondary' });
    if(i>0) buttons.push({ text: 'Back', action: tour.back });
    if(i < stepDefs.length-1) buttons.push({ text: 'Next', action: tour.next });
    else buttons.push({ text: 'Done', action: tour.complete });

    const step = el ? { id: s.id, attachTo: { element: el, on: s.position }, title: s.title, text: s.text, buttons } : { id: s.id, title: s.title, text: s.text, buttons };
    tour.addStep(step);
  }

  // When entering the feature step, open the details panel by emitting SELECTED
  // to ensure the panel opens even if the feature card is in Shadow DOM.
  tour.on('show', async ({ step }) => {
    try{
      const detailsEl = document.querySelector('details-panel');
      const detailStepIds = new Set(['step-details']);

      if(step.id === 'step-feature'){
        const fb = document.querySelector('feature-board');
        if(fb && fb.shadowRoot){
          const featureEl = fb.shadowRoot.querySelector('[data-feature-id]');
          if(featureEl){
            const id = featureEl.getAttribute('data-feature-id');
            try{
              const { bus } = await import('../core/EventBus.js');
              const { FeatureEvents } = await import('../core/EventRegistry.js');
              bus.emit(FeatureEvents.SELECTED, { id });
            }catch(e){ /* ignore emit errors */ }
          }
        }
      } else if (detailStepIds.has(step.id)) {
        if(detailsEl) try{ detailsEl.open = true; }catch(e){}
      } else {
        if(detailsEl && typeof detailsEl.hide === 'function') detailsEl.hide();
        else if(detailsEl) detailsEl.open = false;
      }
    }catch(e){ /* ignore */ }
  });

  // Add small CSS to match app look
  _injectStyles();

  // Persist that user saw the tour
  tour.on('complete', ()=>{ try{ localStorage.setItem('az_planner:tour_seen','1'); }catch(e){} });
  tour.on('cancel', ()=>{ try{ localStorage.setItem('az_planner:tour_seen','1'); }catch(e){} });
  tour.start();
  return tour;
}

function _injectStyles(){
  if(document.getElementById('azplanner-shepherd-style')) return;
  const css = `
    /* Ensure the Shepherd overlay and tooltips appear above the app UI */
    .shepherd-modal-overlay-container { position: fixed !important; z-index: 100; height: 100% !important; width: 100% !important; fill: var(--shepherd-overlay-color, rgba(0,0,0,0.45)) !important; top: 0; left:0}
    .shepherd-element, .shepherd-tooltip, .azplanner-shepherd-step { position: fixed !important; z-index: 101 !important; }
    .azplanner-shepherd-step { background: var(--modal-bg,#fff); color: var(--color-text,#222); border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,0.28); }
    .azplanner-shepherd-step .shepherd-title { font-weight:600; margin-bottom:6px; }
    .shepherd-button { background:var(--color-primary,#1976d2); color:#fff; border-radius:4px; padding:6px 10px; border:none; }
    .shepherd-button-secondary { background: transparent !important; color: var(--color-text,#222) !important; border: 1px solid rgba(0,0,0,0.08) !important; margin-right:6px; }
  `;
  const st = document.createElement('style'); st.id = 'azplanner-shepherd-style'; st.textContent = css; document.head.appendChild(st);
}

export default { startTour };

// initTourFlow: Centralized flow for onboarding -> config -> reload -> tour
export async function initTourFlow(){
  try{
    if(typeof window === 'undefined' || !window.localStorage) return;
    const after = localStorage.getItem('az_planner:start_tour_after_reload');
    if(after){
      try{ localStorage.removeItem('az_planner:start_tour_after_reload'); }catch(e){}
      // Small delay to let app finish rendering
      setTimeout(()=> startTour().catch(()=>{}), 200);
      return;
    }

    const onboardingSeen = localStorage.getItem('az_planner:onboarding_seen');
    const tourSeen = localStorage.getItem('az_planner:tour_seen');

    // If user hasn't seen onboarding, show onboarding then config, then reload
    if(!onboardingSeen){
      try{
        const mh = await import('../components/modalHelpers.js');
        // Avoid duplicate onboarding elements
        if(!document.querySelector('onboarding-modal')){
          await mh.openOnboardingModal();
          try{ localStorage.setItem('az_planner:onboarding_seen','1'); }catch(e){}
          // Open config and wait for user to close it
          await mh.openConfigModal();
          try{ localStorage.setItem('az_planner:start_tour_after_reload','1'); }catch(e){}
          // Give a short timeout for writes to settle then reload
          setTimeout(()=> location.reload(), 120);
        }
      }catch(e){ console.warn('initTourFlow onboarding flow failed', e); }
      return;
    }

    // If onboarding seen but tour not yet seen, start the tour now
    if(!tourSeen){
      // small delay to ensure UI ready
      setTimeout(()=> startTour().catch(()=>{}), 200);
    }
  }catch(e){ /* ignore */ }
}
