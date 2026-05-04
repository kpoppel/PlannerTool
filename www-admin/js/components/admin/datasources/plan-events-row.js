/**
 * Plan Events row renderer and ADO wiki browse helpers for the DataSources admin panel.
 *
 * Renders the Plan Events table row which lets the admin choose between:
 *   "local"    — PlannerTool diskcache (no extra configuration)
 *   "ado_wiki" — Azure DevOps Wiki page (requires project, wiki ID, page path)
 *
 * When "ado_wiki" is selected, sub-form fields appear with live browse dropdowns
 * that load project / wiki / page lists from the ADO REST API.
 *
 * All functions receive the DataSources component instance (`comp`) so they can
 * read its reactive properties and update them directly on user input.
 *
 * Expected comp properties (read/write):
 *   _eventsBackend, _wikiOrgUrl, _wikiProject, _wikiId, _wikiPagePath,
 *   _projects, _projectsLoading, _projectsError,
 *   _wikis, _wikisLoading, _wikisError,
 *   _wikiPages, _wikiPagesLoading, _wikiPagesError,
 *   _pageFilter, _pageDropdownOpen,
 *   _validationErrors, _statusMsg
 *
 * Expected comp services (read only):
 *   comp._adminProvider — adminProvider service for REST calls
 */
import { html } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../../services/providerREST.js';

// ------------------------------------------------------------------
// Browse helpers
// ------------------------------------------------------------------

/**
 * Fetch the list of ADO projects available to the configured PAT.
 * @param {DataSources} comp
 */
export async function fetchProjects(comp) {
  comp._projectsLoading = true;
  comp._projectsError   = '';
  try {
    const res = await adminProvider.browseAzureProjects(comp._wikiOrgUrl);
    if (res.error) {
      comp._projectsError = res.error.includes('PAT')
        ? 'A Personal Access Token is required. Set it in your account settings.'
        : `Could not load projects: ${res.error}`;
    } else {
      comp._projects = res.projects || [];
    }
  } catch (e) {
    comp._projectsError = String(e);
  } finally {
    comp._projectsLoading = false;
  }
}

/**
 * Handle organization URL typing in the ADO wiki sub-form.
 *
 * This only updates the local field value. Project assistance is reloaded on
 * field commit (change/blur), not on every keystroke.
 * @param {DataSources} comp
 * @param {string} value
 */
export function onWikiOrgUrlInput(comp, value) {
  if (comp._wikiOrgUrlAppliedTrimmed === undefined) {
    comp._wikiOrgUrlAppliedTrimmed = String(comp._wikiOrgUrl || '').trim();
  }
  comp._wikiOrgUrl = String(value || '');
}

/**
 * Commit organization URL edits on field change/blur.
 *
 * Resets dependent selections (project/wiki/page) when the committed org has
 * changed and reloads projects using the committed value.
 * @param {DataSources} comp
 */
export function onWikiOrgUrlCommit(comp) {
  const nextTrimmed = String(comp._wikiOrgUrl || '').trim();
  const appliedTrimmed = comp._wikiOrgUrlAppliedTrimmed !== undefined
    ? String(comp._wikiOrgUrlAppliedTrimmed)
    : nextTrimmed;

  // Avoid unnecessary resets/reloads when only whitespace differs.
  if (appliedTrimmed === nextTrimmed) return;

  comp._wikiProject = '';
  comp._wikiId = '';
  comp._wikiPages = [];
  comp._wikis = [];
  comp._projects = [];
  comp._projectsError = '';
  comp._wikisError = '';
  comp._wikiPagesError = '';
  comp._wikiOrgUrlAppliedTrimmed = nextTrimmed;

  if (nextTrimmed) {
    fetchProjects(comp);
  }
}

/**
 * Fetch wikis for the given ADO project.
 * Auto-selects the wiki if only one is available; fetches pages when a wiki
 * is already selected.
 * @param {DataSources} comp
 * @param {string} project
 */
export async function fetchWikis(comp, project) {
  if (!project) return;
  comp._wikisLoading = true;
  comp._wikisError   = '';
  comp._wikis        = [];
  comp._wikiPages    = [];
  try {
    const res = await adminProvider.browseWikis(project, comp._wikiOrgUrl);
    if (res.error) {
      comp._wikisError = `Could not load wikis: ${res.error}`;
    } else {
      comp._wikis = res.wikis || [];
      // Auto-select if only one wiki, or re-select a previously saved one
      if (comp._wikis.length === 1 && !comp._wikiId)
        comp._wikiId = comp._wikis[0].name;
      if (comp._wikiId) fetchWikiPages(comp, project, comp._wikiId);
    }
  } catch (e) {
    comp._wikisError = String(e);
  } finally {
    comp._wikisLoading = false;
  }
}

/**
 * Fetch pages for the given wiki.
 * @param {DataSources} comp
 * @param {string} project
 * @param {string} wikiId
 */
export async function fetchWikiPages(comp, project, wikiId) {
  if (!project || !wikiId) return;
  comp._wikiPagesLoading = true;
  comp._wikiPagesError   = '';
  try {
    const res = await adminProvider.browseWikiPages(project, wikiId, comp._wikiOrgUrl);
    if (res.error) {
      comp._wikiPagesError = `Could not load pages: ${res.error}`;
    } else {
      comp._wikiPages = res.pages || [];
    }
  } catch (e) {
    comp._wikiPagesError = String(e);
  } finally {
    comp._wikiPagesLoading = false;
  }
}

// ------------------------------------------------------------------
// Row renderer
// ------------------------------------------------------------------

/**
 * Render the Plan Events table row.
 * @param {DataSources} comp
 */
export function renderPlanEventsRow(comp) {
  const isWiki = comp._eventsBackend === 'ado_wiki';
  const errs   = comp._validationErrors;

  return html`
    <tr>
      <td>
        <div class="domain-name">Plan Events</div>
        <div class="domain-desc">
          Timeline markers tied to a plan — milestones, releases, code freezes.
        </div>
      </td>
      <td>
        <div class="backend-select-wrap">
          <select class="backend-select"
            @change=${(e) => {
              comp._eventsBackend    = e.target.value;
              comp._validationErrors = {};
              comp._statusMsg        = '';
              if (comp._eventsBackend === 'ado_wiki' && comp._projects.length === 0)
                fetchProjects(comp);
            }}
          >
            <option value="local"    ?selected=${comp._eventsBackend === 'local'}>
              Local database (PlannerTool)
            </option>
            <option value="ado_wiki" ?selected=${comp._eventsBackend === 'ado_wiki'}>
              Azure DevOps Wiki page
            </option>
          </select>

          ${isWiki ? _renderWikiSubForm(comp, errs) : ''}
        </div>
      </td>
      <td class="ttl-col"><span class="ttl-dash">—</span></td>
    </tr>`;
}

// ------------------------------------------------------------------
// Private: wiki sub-form (used only by renderPlanEventsRow)
// ------------------------------------------------------------------

function _renderWikiSubForm(comp, errs) {
  return html`
    <div class="sub-form">
      <div class="field full">
        <label>Organization URL *</label>
        <div class="desc">Azure DevOps organization name or URL (e.g. "MyCompany" or "https://dev.azure.com/MyCompany"). Stored here independently of the work-item backend.</div>
        <input type="text"
          class=${errs.evtOrgUrl ? 'error' : ''}
          .value=${comp._wikiOrgUrl}
          placeholder="e.g. MyCompany"
          @input=${(e) => { onWikiOrgUrlInput(comp, e.target.value); }}
          @change=${() => { onWikiOrgUrlCommit(comp); }}
        />
        ${errs.evtOrgUrl ? html`<div class="error-msg">${errs.evtOrgUrl}</div>` : ''}
      </div>
      <div class="field">
        <label>ADO Project *</label>
        <div class="desc">Azure DevOps project name.</div>
        ${comp._projectsLoading ? html`<div class="desc">Loading projects…</div>` : ''}
        ${comp._projectsError   ? html`<div class="error-msg">${comp._projectsError}</div>` : ''}
        ${comp._projects.length > 0 ? html`
          <select
            class=${errs.evtProject ? 'error' : ''}
            @change=${(e) => {
              comp._wikiProject = e.target.value;
              comp._wikiId = '';
              if (comp._wikiProject) fetchWikis(comp, comp._wikiProject);
            }}
          >
            <option value="">-- Select project --</option>
            ${comp._projects.map(p => html`
              <option value=${p} ?selected=${comp._wikiProject === p}>${p}</option>
            `)}
          </select>` : html`
          <input type="text"
            class=${errs.evtProject ? 'error' : ''}
            .value=${comp._wikiProject}
            placeholder="e.g. MyProject"
            @input=${(e) => {
              comp._wikiProject = e.target.value;
              comp._wikiId = '';
            }}
          />`}
        ${errs.evtProject ? html`<div class="error-msg">${errs.evtProject}</div>` : ''}
      </div>

      <div class="field">
        <label>Wiki *</label>
        <div class="desc">Typically <em>&lt;ProjectName&gt;.wiki</em> for the project wiki.</div>
        ${comp._wikisLoading ? html`<div class="desc">Loading wikis…</div>` : ''}
        ${comp._wikisError   ? html`<div class="error-msg">${comp._wikisError}</div>` : ''}
        ${comp._wikis.length > 0 ? html`
          <select
            class=${errs.evtWikiId ? 'error' : ''}
            @change=${(e) => {
              comp._wikiId    = e.target.value;
              comp._wikiPages = [];
              if (comp._wikiId)
                fetchWikiPages(comp, comp._wikiProject, comp._wikiId);
            }}
          >
            <option value="">-- Select wiki --</option>
            ${comp._wikis.map(w => html`
              <option value=${w.name} ?selected=${comp._wikiId === w.name}>
                ${w.name} (${w.type || 'wiki'})
              </option>
            `)}
          </select>` : html`
          <input type="text"
            class=${errs.evtWikiId ? 'error' : ''}
            .value=${comp._wikiId}
            placeholder="e.g. MyProject.wiki"
            @input=${(e) => { comp._wikiId = e.target.value; }}
          />`}
        ${errs.evtWikiId ? html`<div class="error-msg">${errs.evtWikiId}</div>` : ''}
      </div>

      <div class="field full">
        <label>Page Path</label>
        <div class="desc">
          Wiki page path where events are stored.
          The page is created automatically on first write —
          but its parent must already exist.
          ${comp._wikiPagesLoading ? html` <em>Loading pages…</em>` : ''}
          ${comp._wikiPages.length > 0 && !comp._wikiPagesLoading
            ? html` Type to filter existing pages or enter a new path.` : ''}
        </div>
        ${comp._wikiPagesError ? html`<div class="error-msg">${comp._wikiPagesError}</div>` : ''}
        <div class="page-combo">
          <input type="text"
            class=${errs.evtPagePath ? 'error' : ''}
            .value=${comp._wikiPagePath}
            placeholder="/PlannerTool/Events"
            autocomplete="off"
            @focus=${() => { comp._pageDropdownOpen = true; }}
            @input=${(e) => {
              comp._wikiPagePath     = e.target.value;
              comp._pageFilter       = e.target.value.toLowerCase();
              comp._pageDropdownOpen = true;
            }}
            @blur=${() => {
              // Delay so a click on a suggestion option registers first
              setTimeout(() => { comp._pageDropdownOpen = false; }, 150);
            }}
          />
          ${comp._pageDropdownOpen && comp._wikiPages.length > 0 ? (() => {
            const filter  = comp._pageFilter;
            const matches = filter
              ? comp._wikiPages.filter(p => p.toLowerCase().includes(filter))
              : comp._wikiPages;
            if (!matches.length) return '';
            return html`
              <div class="page-suggestions">
                ${matches.slice(0, 60).map(p => html`
                  <div class="page-suggestion-item"
                    @mousedown=${() => {
                      comp._wikiPagePath     = p;
                      comp._pageFilter       = '';
                      comp._pageDropdownOpen = false;
                    }}
                  >${p}</div>
                `)}
              </div>`;
          })() : ''}
        </div>
        ${errs.evtPagePath ? html`<div class="error-msg">${errs.evtPagePath}</div>` : ''}
      </div>
    </div>`;
}
