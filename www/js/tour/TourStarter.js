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
    { id: 'step-gear', selector: '[data-tour="gear"]', position: 'right', title: 'Configuration', text: 'Open the configuration here to add your email and PAT (Personal Access Token).' },
    { id: 'step-sidebar', selector: 'app-sidebar', position: 'right', title: 'Sidebar', text: 'Use the sidebar to select tasks to view, team allocation and scenarios as well as filtering options.' },
    { id: 'step-zoom', selector: '[data-tour="zoom"]', position: 'bottom', title: 'Zoom', text: 'Zoom controls let you change the time scale of the planner.' },
    { id: 'step-condensed', selector: '[data-tour="condensed-view"]', position: 'bottom', title: 'Condensed View', text: 'Toggle condensed view to see more features at once.' },
    { id: 'step-dependency-renderer', selector: '[data-tour="dependency-renderer"]', position: 'bottom', title: 'Dependencies', text: 'Toggle dependency rendering to visualize relationships between features.' },
    { id: 'step-unassigned', selector: '[data-tour="unassigned-view"]', position: 'bottom', title: 'Unassigned Features', text: 'Toggle to show or hide features that have not yet assigned capacity to any team.' },
    { id: 'step-unplanned', selector: '[data-tour="unplanned-view"]', position: 'bottom', title: 'Unplanned Work', text: 'Toggle to show or hide unplanned work items in the timeline. Unplanned work items are those without start and end dates.' },
    { id: 'step-capacity', selector: '[data-tour="capacity-view"]', position: 'bottom', title: 'Capacity View', text: 'Use the capacity view buttons to see team capacity data or sums of capacity per plan.' },
    { id: 'step-sort', selector: '[data-tour="sort-view"]', position: 'bottom', title: 'Sort Features', text: 'Use sorting to order features by rank or date.' },
    { id: 'step-tasktypes', selector: '[data-tour="tasktypes-view"]', position: 'bottom', title: 'Task Types', text: 'Use task type filters to show or hide Epics and Features.' },
    { id: 'step-state-filters', selector: '[data-tour="state-filters"]', position: 'bottom', title: 'State Filters', text: 'Use filters to limit visible features by the task state.' },
    { id: 'step-planning', selector: '[data-tour="planning"]', position: 'bottom', title: 'Planning', text: 'Select which tasks to focus on in the planning view.' },
    { id: 'step-allocations', selector: '[data-tour="allocations"]', position: 'bottom', title: 'Allocations View', text: 'Toggle allocations view to see team assignments on the timeline.' },
    { id: 'step-scenarios', selector: '[data-tour="scenarios"]', position: 'bottom', title: 'Scenarios', text: 'Use scenarios to create different planning scenarios and compare them.' },
    { id: 'step-tools', selector: '[data-tour="tools"]', position: 'bottom', title: 'Tools', text: 'Tools are extensions enabled via plugins. Here you can find tools for graph viewing, exporting and more.' },
    { id: 'step-timeline', selector: 'timeline-board', position: 'top', title: 'Timeline', text: 'This is the timeline view showing features and allocations. Try zooming levels and filters.' },
    { id: 'step-feature', selector: '[data-tour="feature-card"]', position: 'right', title: 'Feature card', text: 'When feature cards are loaded, click a feature card to open details and edit estimates. you can see the task description and links back to ADC.' },
    { id: 'step-help', selector: '[data-tour="help"]', position: 'left', title: 'Help & Docs', text: 'Open help to read docs, view keyboard shortcuts, or replay the tour. Thanks for getting to the end.' }
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

    const step = el ? { id: s.id, attachTo: { element: s.selector, on: s.position }, title: s.title, text: s.text, buttons } : { id: s.id, title: s.title, text: s.text, buttons };
    tour.addStep(step);
  }

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
