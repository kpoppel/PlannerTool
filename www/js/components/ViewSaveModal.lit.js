import { LitElement, html } from '../vendor/lit.js';
import './Modal.lit.js';
import { state } from '../services/State.js';

export class ViewSaveModal extends LitElement {
  static properties = {
    name: { type: String },
    previewData: { type: Object },
    _status: { type: String },
    _saving: { type: Boolean },
  };

  constructor() {
    super();
    this.name = '';
    this.previewData = null;
    this._status = '';
    this._saving = false;
  }

  connectedCallback() {
    super.connectedCallback();
    // Capture current state for preview
    try {
      this._capturePreviewData();
    } catch (e) {
      /* ignore preview capture errors */
    }
  }

  firstUpdated() {
    // Open the inner modal-lit after the first render. Using the renderRoot
    // directly avoids the fragile nested querySelector pattern.
    const inner = this.renderRoot.querySelector('modal-lit');
    if (inner) inner.open = true;
    // Auto-focus the name input
    setTimeout(() => {
      const input = this.renderRoot.querySelector('#saveViewInput');
      if (input) input.focus();
    }, 10);
  }

  async _handleSave() {
    const input = this.renderRoot.querySelector('#saveViewInput');
    const val = input ? input.value.trim() : '';
    if (!val) {
      this._status = 'Please enter a view name.';
      return;
    }
    this._saving = true;
    this._status = '';
    try {
      await state.viewManagementService.saveCurrentView(val);
      this.dispatchEvent(
        new CustomEvent('modal-close', { bubbles: true, composed: true })
      );
      this.remove();
    } catch (err) {
      this._status = `Failed to save view: ${err.message || err}`;
      this._saving = false;
    }
  }

  _handleCancel() {
    this.dispatchEvent(new CustomEvent('modal-close', { bubbles: true, composed: true }));
    this.remove();
  }

  _handleKeydown(e) {
    if (e.key === 'Enter') this._handleSave();
    if (e.key === 'Escape') this._handleCancel();
  }

  _capturePreviewData() {
    // Capture what will be saved
    this.previewData = {
      selectedProjects: [],
      selectedTeams: [],
      viewOptions: {},
      taskTypes: [],
      graphType: 'team',
      expansionOptions: {
        expandParentChild: false,
        expandRelations: false,
        expandTeamAllocated: false,
      },
    };

    // Get selected projects
    if (state.projects) {
      this.previewData.selectedProjects = state.projects
        .filter((p) => p.selected)
        .map((p) => p.name || p.id);
    }

    // Get selected teams
    if (state.teams) {
      this.previewData.selectedTeams = state.teams
        .filter((t) => t.selected)
        .map((t) => t.name || t.id);
    }

    // Get view options
    if (state._viewService) {
      const vo = state._viewService.captureCurrentView();
      this.previewData.viewOptions = {
        timelineScale: vo.timelineScale || 'months',
        condensedCards: vo.condensedCards ? 'Yes' : 'No',
        sortMode: vo.featureSortMode || 'rank',
        showDependencies: vo.showDependencies ? 'Yes' : 'No',
      };
    }

    // Get task types from sidebar
    const sidebarElement = document.querySelector('app-sidebar');
    if (sidebarElement && sidebarElement.selectedTaskTypes) {
      try {
        this.previewData.taskTypes = Array.from(sidebarElement.selectedTaskTypes || []);
      } catch (e) {
        /* ignore */
      }
    }

    // Get graph type from sidebar
    if (sidebarElement && sidebarElement._graphType) {
      try {
        this.previewData.graphType = sidebarElement._graphType;
      } catch (e) {
        /* ignore */
      }
    }

    // Get expansion options from sidebar
    if (sidebarElement) {
      try {
        this.previewData.expansionOptions = {
          expandParentChild: sidebarElement.expandParentChild || false,
          expandRelations: sidebarElement.expandRelations || false,
          expandTeamAllocated: sidebarElement.expandTeamAllocated || false,
        };
      } catch (e) {
        /* ignore */
      }
    }

    this.requestUpdate();
  }

  render() {
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Save View</h3></div>
        <div>
          <style>
            .modal-content {
              max-width: 100%;
              overflow-x: hidden;
            }
            .modal-field {
              margin-bottom: 16px;
            }
            .modal-field label {
              display: block;
              margin-bottom: 6px;
              font-weight: 500;
              color: #333;
              font-size: 14px;
            }
            .modal-field input {
              width: 100%;
              max-width: 100%;
              box-sizing: border-box;
              padding: 8px 10px;
              border: 1px solid #ccc;
              border-radius: 4px;
              font-size: 14px;
              font-family: inherit;
            }
            .modal-field input:focus {
              outline: 2px solid rgba(52, 152, 219, 0.3);
              border-color: #3498db;
            }
            .preview-section {
              margin-top: 16px;
              padding: 12px;
              background: #f5f5f5;
              border: 1px solid #ddd;
              border-radius: 4px;
              max-height: 300px;
              overflow-y: auto;
            }
            .preview-section h4 {
              margin: 0 0 8px 0;
              font-size: 13px;
              font-weight: 600;
              color: #555;
            }
            .preview-group {
              margin-bottom: 12px;
            }
            .preview-group:last-child {
              margin-bottom: 0;
            }
            .preview-label {
              font-size: 12px;
              font-weight: 600;
              color: #666;
              margin-bottom: 4px;
            }
            .preview-list {
              font-size: 12px;
              color: #444;
              padding-left: 16px;
              margin: 0;
            }
            .preview-value {
              font-size: 12px;
              color: #444;
              padding-left: 16px;
            }
            .preview-badge {
              display: inline-block;
              background: #e0e0e0;
              padding: 2px 8px;
              border-radius: 12px;
              margin: 2px 4px 2px 0;
              font-size: 11px;
            }
            .status {
              margin-top: 12px;
              padding: 8px;
              border-radius: 4px;
              font-size: 14px;
              color: #d32f2f;
              background: #ffebee;
            }
            .status:empty {
              display: none;
            }
          </style>
          <div class="modal-content">
            <div class="modal-field">
              <label for="saveViewInput">View Name</label>
              <input
                id="saveViewInput"
                type="text"
                value="${this.name}"
                placeholder="Enter view name..."
                @keydown=${this._handleKeydown}
              />
            </div>

            ${this.previewData ?
              html`
                <div class="preview-section">
                  <h4>📋 Settings to be saved:</h4>

                  <div class="preview-group">
                    <div class="preview-label">
                      Selected Plans (${this.previewData.selectedProjects.length}):
                    </div>
                    <div class="preview-value">
                      ${this.previewData.selectedProjects.length === 0 ?
                        html`<em>None</em>`
                      : this.previewData.selectedProjects.map(
                          (name) => html`<span class="preview-badge">${name}</span>`
                        )}
                    </div>
                  </div>

                  <div class="preview-group">
                    <div class="preview-label">
                      Selected Teams (${this.previewData.selectedTeams.length}):
                    </div>
                    <div class="preview-value">
                      ${this.previewData.selectedTeams.length === 0 ?
                        html`<em>None</em>`
                      : this.previewData.selectedTeams.map(
                          (name) => html`<span class="preview-badge">${name}</span>`
                        )}
                    </div>
                  </div>

                  <div class="preview-group">
                    <div class="preview-label">Display Options:</div>
                    <ul class="preview-list">
                      <li>
                        Timeline Scale:
                        <strong>${this.previewData.viewOptions.timelineScale}</strong>
                      </li>
                      <li>
                        Condensed Cards:
                        <strong>${this.previewData.viewOptions.condensedCards}</strong>
                      </li>
                      <li>
                        Sort Mode:
                        <strong>${this.previewData.viewOptions.sortMode}</strong>
                      </li>
                      <li>
                        Show Dependencies:
                        <strong>${this.previewData.viewOptions.showDependencies}</strong>
                      </li>
                      <li>
                        Graph Type:
                        <strong>${this.previewData.graphType}</strong>
                      </li>
                    </ul>
                  </div>

                  <div class="preview-group">
                    <div class="preview-label">
                      Selected Task Types (${this.previewData.taskTypes.length}):
                    </div>
                    <div class="preview-value">
                      ${this.previewData.taskTypes.length === 0 ?
                        html`<em>None</em>`
                      : this.previewData.taskTypes.map(
                          (type) => html`<span class="preview-badge">${type}</span>`
                        )}
                    </div>
                  </div>

                  <div class="preview-group">
                    <div class="preview-label">Expansion Options:</div>
                    <ul class="preview-list">
                      <li>
                        Expand Parent/Child:
                        <strong
                          >${this.previewData.expansionOptions.expandParentChild ?
                            'Yes'
                          : 'No'}</strong
                        >
                      </li>
                      <li>
                        Expand Relations:
                        <strong
                          >${this.previewData.expansionOptions.expandRelations ?
                            'Yes'
                          : 'No'}</strong
                        >
                      </li>
                      <li>
                        Expand Team Allocated:
                        <strong
                          >${this.previewData.expansionOptions.expandTeamAllocated ?
                            'Yes'
                          : 'No'}</strong
                        >
                      </li>
                    </ul>
                  </div>
                </div>
              `
            : ''}
            ${this._status ? html`<div class="status">${this._status}</div>` : ''}
          </div>
        </div>
        <div slot="footer" class="modal-footer">
          <button
            class="btn primary"
            ?disabled=${this._saving}
            @click=${this._handleSave}
          >
            Save
          </button>
          <button class="btn" ?disabled=${this._saving} @click=${this._handleCancel}>
            Cancel
          </button>
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('view-save-modal', ViewSaveModal);
