import '/static/js/vendor/lit.js';
import './components/AdminApp.lit.js';
import './components/admin/System.lit.js';
import './components/admin/Users.lit.js';
import './components/admin/Projects.lit.js';
import './components/admin/Workforce.lit.js';
import './components/admin/AreaMappingsNew.lit.js';
import './components/admin/Iterations.lit.js';
import './components/admin/Utilities.lit.js';
import './components/admin/BackupSnapshots.lit.js';
import { dataService } from '/static/js/services/dataService.js';

async function mountAdminApp() {
  // Ensure the dataService attempts to initialize (may create a session
  // if a stored email exists). This mirrors the main app bootstrap.
  try {
    await dataService.init();
  } catch (err) {
    /* ignore init errors */
  }

  // After init, check whether the current session is an admin. If the
  // check fails with 401, navigate to /admin so the server returns the
  // access-denied page (consistent UX). If the check succeeds, mount
  // the admin app.
  try {
    const res = await fetch(`${window.APP_BASE_URL}/admin/check`, {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (res.ok) {
      const access = await res.json();
      mount(access.permissions);
      return;
    }
    if (res.status === 401) {
      // Redirect to the login page; the server has already cleared the cookie.
      window.location.href = `${window.APP_BASE_URL}/admin/login?error=not_admin`;
      return;
    }
  } catch (err) {
    console.warn('admin: check failed', err);
  }

  window.location.href = `${window.APP_BASE_URL}/admin/login`;

  function mount(permissions) {
    const root = document.getElementById('admin-root') || document.body;
    if (!document.querySelector('admin-app')) {
      const app = document.createElement('admin-app');
      app.setPermissions(permissions);
      root.appendChild(app);
    }
  }
}

mountAdminApp();
