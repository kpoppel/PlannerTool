/**
 * ADO backend row group renderer for the DataSources admin panel.
 *
 * Renders three table rows (Work Items, Work Item History, Delivery Plans & Iterations)
 * that share a single backend selection. The first row carries the backend dropdown
 * and its conditional inline sub-form; the other two show "Same as Work Items".
 *
 * All functions receive the DataSources component instance (`comp`) so they can
 * read its reactive properties and update them directly on user input — the same
 * as if these were instance methods, but co-located in this file.
 *
 * Expected comp properties (read/write):
 *   _adoBackendType, _orgUrl, _fixtureDir, _fixturePersist,
 *   _genPersistEnabled, _genPersistDir, _genSeed, _genNPlans, _genItemsPerArea,
 *   _genNPis, _genSprintsPerPi, _genRevisionsMin, _genRevisionsMax,
 *   _staticDataPath, _ttls, _validationErrors, _statusMsg
 */
import { html } from '/static/js/vendor/lit.js';

/**
 * Render the three ADO domain rows as a group.
 * @param {DataSources} comp
 */
export function renderAdoGroup(comp) {
  const errs = comp._validationErrors;
  const type = comp._adoBackendType;

  return html`
    <tr>
      <td>
        <div class="domain-name">Work Items</div>
        <div class="domain-desc">Features, epics, and tasks fetched from the remote work-item system.</div>
        <div class="domain-sub">Work Item History and Delivery Plans &amp; Iterations use the same backend (see rows below).</div>
      </td>
      <td>
        <div class="backend-select-wrap">
          <select class="backend-select"
            @change=${(e) => {
              comp._adoBackendType   = e.target.value;
              comp._validationErrors = {};
              comp._statusMsg        = '';
            }}
          >
            <option value="ado_live"           ?selected=${type === 'ado_live'}>Live Azure DevOps REST API</option>
            <option value="ado_mock_fixture"   ?selected=${type === 'ado_mock_fixture'}>Fixture Mock (pre-recorded)</option>
            <option value="ado_mock_generator" ?selected=${type === 'ado_mock_generator'}>Synthetic Generator Mock</option>
            <option value="ado_static"         ?selected=${type === 'ado_static'}>Static File (read-only)</option>
          </select>
          ${renderAdoSubForm(comp, type, errs)}
        </div>
      </td>
      <td class="ttl-col">${comp._ttlInput('fetch_tasks')}</td>
    </tr>
    <tr>
      <td>
        <div class="domain-name">Work Item History</div>
        <div class="domain-desc">Revision history for individual work items.</div>
      </td>
      <td>
        <span class="locked-badge" title="Shares backend with Work Items">↑ Same as Work Items</span>
      </td>
      <td class="ttl-col">${comp._ttlInput('fetch_history')}</td>
    </tr>
    <tr>
      <td>
        <div class="domain-name">Delivery Plans &amp; Iterations</div>
        <div class="domain-desc">Delivery plans, sprints, and iteration paths.</div>
      </td>
      <td>
        <span class="locked-badge" title="Shares backend with Work Items">↑ Same as Work Items</span>
      </td>
      <td class="ttl-col">
        <div class="ttl-stack">
          <div>
            <div class="ttl-stack-label">Plans</div>
            ${comp._ttlInput('fetch_plans')}
          </div>
          <div>
            <div class="ttl-stack-label">Iterations</div>
            ${comp._ttlInput('fetch_iterations')}
          </div>
          <div>
            <div class="ttl-stack-label">Markers</div>
            ${comp._ttlInput('fetch_markers')}
          </div>
        </div>
      </td>
    </tr>`;
}

/**
 * Render the inline sub-form for the currently selected ADO backend type.
 * Returns an empty string when no sub-form is needed.
 * @param {DataSources} comp
 * @param {'ado_live'|'ado_mock_fixture'|'ado_mock_generator'|'ado_static'} type
 * @param {object} errs  Current validation error map
 */
export function renderAdoSubForm(comp, type, errs) {
  if (type === 'ado_live') {
    return html`
      <div class="sub-form">
        <div class="field full">
          <label>Organization URL *</label>
          <div class="desc">Azure DevOps organization name or URL (e.g. "MyCompany" or "https://dev.azure.com/MyCompany").</div>
          <input type="text"
            class=${errs.orgUrl ? 'error' : ''}
            .value=${comp._orgUrl}
            placeholder="e.g. MyCompany"
            @input=${(e) => { comp._orgUrl = e.target.value; }}
          />
          ${errs.orgUrl ? html`<div class="error-msg">${errs.orgUrl}</div>` : ''}
        </div>
      </div>`;
  }

  if (type === 'ado_mock_fixture') {
    return html`
      <div class="sub-form">
        <div class="field full">
          <label>Fixture Data Directory</label>
          <div class="desc">Path to the directory containing pre-recorded SDK fixture files (sdk_*.json).</div>
          <input type="text"
            class=${errs.fixtureDir ? 'error' : ''}
            .value=${comp._fixtureDir}
            placeholder="data/azure_mock"
            @input=${(e) => { comp._fixtureDir = e.target.value; }}
          />
          ${errs.fixtureDir ? html`<div class="error-msg">${errs.fixtureDir}</div>` : ''}
        </div>
        <div class="field full">
          <div class="toggle-row">
            <input type="checkbox"
              id="fixture-persist"
              ?checked=${comp._fixturePersist}
              @change=${(e) => { comp._fixturePersist = e.target.checked; }}
            />
            <label for="fixture-persist" class="toggle-label">
              <span>Persist Fixture Mutations</span>
              <span class="desc">Write save-to-cloud mutations back to the fixture files so changes survive restarts.</span>
            </label>
          </div>
        </div>
      </div>`;
  }

  if (type === 'ado_mock_generator') {
    return html`
      <div class="sub-form">
        <div class="field full">
          <div class="toggle-row">
            <input type="checkbox"
              id="gen-persist"
              ?checked=${comp._genPersistEnabled}
              @change=${(e) => { comp._genPersistEnabled = e.target.checked; }}
            />
            <label for="gen-persist" class="toggle-label">
              <span>Persist Generated Data</span>
              <span class="desc">Write the generated dataset to disk and persist mutations. Requires a fixed seed for reproducible results.</span>
            </label>
          </div>
        </div>
        ${comp._genPersistEnabled ? html`
          <div class="field full">
            <label>Persist Directory</label>
            <div class="desc">Directory for persisted fixture files (defaults to data/azure_mock_generated).</div>
            <input type="text"
              .value=${comp._genPersistDir}
              placeholder="data/azure_mock_generated"
              @input=${(e) => { comp._genPersistDir = e.target.value; }}
            />
          </div>` : ''}
        <div class="field">
          <label>Random Seed</label>
          <div class="desc">Fix for reproducible datasets; leave blank for random.</div>
          <input type="number"
            .value=${comp._genSeed}
            placeholder="(random)"
            @input=${(e) => { comp._genSeed = e.target.value; }}
          />
        </div>
        <div class="field">
          <label>Number of Plans</label>
          <input type="number" min="1"
            .value=${comp._genNPlans}
            @input=${(e) => { comp._genNPlans = e.target.value; }}
          />
        </div>
        <div class="field">
          <label>Items per Area Path</label>
          <input type="number" min="1"
            .value=${comp._genItemsPerArea}
            @input=${(e) => { comp._genItemsPerArea = e.target.value; }}
          />
        </div>
        <div class="field">
          <label>Number of PIs</label>
          <input type="number" min="1"
            .value=${comp._genNPis}
            @input=${(e) => { comp._genNPis = e.target.value; }}
          />
        </div>
        <div class="field">
          <label>Sprints per PI</label>
          <input type="number" min="1"
            .value=${comp._genSprintsPerPi}
            @input=${(e) => { comp._genSprintsPerPi = e.target.value; }}
          />
        </div>
        <div class="field">
          <label>Revisions Min</label>
          <input type="number" min="1"
            .value=${comp._genRevisionsMin}
            @input=${(e) => { comp._genRevisionsMin = e.target.value; }}
          />
        </div>
        <div class="field">
          <label>Revisions Max</label>
          <input type="number" min="1"
            .value=${comp._genRevisionsMax}
            @input=${(e) => { comp._genRevisionsMax = e.target.value; }}
          />
        </div>
      </div>`;
  }

  if (type === 'ado_static') {
    return html`
      <div class="sub-form">
        <div class="field full">
          <label>Static Data File Path *</label>
          <div class="desc">Path to a YAML or JSON file mapping area_path → list of DomainTask dicts.</div>
          <input type="text"
            class=${errs.staticDataPath ? 'error' : ''}
            .value=${comp._staticDataPath}
            placeholder="data/static_tasks.yml"
            @input=${(e) => { comp._staticDataPath = e.target.value; }}
          />
          ${errs.staticDataPath ? html`<div class="error-msg">${errs.staticDataPath}</div>` : ''}
        </div>
      </div>`;
  }

  return '';
}
