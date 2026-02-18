import '/static/js/vendor/lit.js';
import './components/AdminApp.lit.js';
import './components/admin/System.lit.js';
import './components/admin/Users.lit.js';
import './components/admin/Projects.lit.js';
import './components/admin/Teams.lit.js';
import './components/admin/Cost.lit.js';
import './components/admin/AreaMappingsNew.lit.js';
import './components/admin/Iterations.lit.js';
import './components/admin/Utilities.lit.js';
import { dataService } from '/static/js/services/dataService.js';

async function mountAdminApp(){
  // Ensure the dataService attempts to initialize (may create a session
  // if a stored email exists). This mirrors the main app bootstrap.
  try{
    await dataService.init();
  }catch(err){ /* ignore init errors */ }

  // After init, check whether the current session is an admin. If the
  // check fails with 401, navigate to /admin so the server returns the
  // access-denied page (consistent UX). If the check succeeds, mount
  // the admin app.
  try{
    const res = await fetch('/admin/check', { method: 'GET', credentials: 'same-origin' });
    if (res.ok){
      mount();
      return;
    }
    if (res.status === 401){
      // Let the server render the access-denied page to the browser.
      window.location.href = '/admin';
      return;
    }
  }catch(err){
    // Network errors or unexpected responses: fall through and mount
    // the app so it can attempt bootstrap client-side.
    console.warn('admin: check failed', err);
  }

  mount();

  function mount(){
    const root = document.getElementById('admin-root') || document.body;
    if (!document.querySelector('admin-app')) {
      const app = document.createElement('admin-app');
      root.appendChild(app);
    }
  }
}

mountAdminApp();
