/**
 * SamplePluginComponent - Displays sample plugin configuration and status
 * 
 * This is a minimal UI component that demonstrates:
 * - How to render custom configuration
 * - How to display plugin status in the UI
 * - Lit element lifecycle and styling
 */
import { LitElement, html, css } from '../vendor/lit.js';

export class SamplePluginComponent extends LitElement {
  static properties = {
    customConfig: { type: Object },
    visible: { type: Boolean, reflect: true },
  };

  static styles = css`
    :host {
      display: none;
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 1000;
    }

    :host([visible]) {
      display: block;
    }

    .panel {
      background: white;
      border: 2px solid #6366f1;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      min-width: 280px;
    }

    .header {
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
      margin: 0 0 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .badge {
      display: inline-block;
      background: #6366f1;
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .config-section {
      background: #f9fafb;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
    }

    .config-section h3 {
      margin: 0 0 8px;
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
    }

    .config-item {
      margin-bottom: 8px;
      font-size: 13px;
    }

    .config-item:last-child {
      margin-bottom: 0;
    }

    .label {
      color: #6b7280;
      font-weight: 500;
    }

    .value {
      color: #1f2937;
      font-family: 'Monaco', 'Courier New', monospace;
      font-weight: 600;
    }

    .status {
      background: #dbeafe;
      border: 1px solid #93c5fd;
      border-radius: 4px;
      padding: 8px 10px;
      font-size: 12px;
      color: #1e40af;
      text-align: center;
    }

    .close-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: #9ca3af;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .close-btn:hover {
      color: #374151;
    }
  `;

  constructor() {
    super();
    this.customConfig = {};
    this.visible = false;
  }

  connectedCallback() {
    super.connectedCallback();
  }

  open() {
    this.visible = true;
  }

  close() {
    this.visible = false;
  }

  _onClose() {
    this.close();
  }

  render() {
    const { enableLogging, sampleSetting, threshold } = this.customConfig;

    return html`
      <div class="panel">
        <button class="close-btn" @click=${() => this._onClose()}>✕</button>
        <h2 class="header">
          <span class="badge">Sample</span>
          Plugin Demo
        </h2>

        <div class="config-section">
          <h3>Configuration</h3>
          <div class="config-item">
            <span class="label">Setting:</span>
            <span class="value">${sampleSetting || '(not set)'}</span>
          </div>
          <div class="config-item">
            <span class="label">Logging:</span>
            <span class="value">${enableLogging ? '✓ Enabled' : '✗ Disabled'}</span>
          </div>
          <div class="config-item">
            <span class="label">Threshold:</span>
            <span class="value">${threshold ?? '(not set)'}</span>
          </div>
        </div>

        <div class="status">
          Edit these settings in the Admin Panel to change behavior.
        </div>
      </div>
    `;
  }
}

customElements.define('sample-plugin-component', SamplePluginComponent);
