import { LitElement, html, css } from '../vendor/lit.js';

const QUEUES = [
  { id: 'needs-my-decision', label: 'Needs my decision' },
  { id: 'needs-my-re-plan', label: 'Needs my re-plan' },
  { id: 'blocked-on-sibling', label: 'Blocked on a sibling project' },
  { id: 'applied-to-my-project', label: 'Applied to my project' },
  { id: 'waiting', label: 'Waiting on another project' },
  { id: 'unreconciled-but-live', label: 'Unreconciled but live' },
  { id: 'unclaimed', label: 'Unclaimed' },
  { id: 'recently-resolved', label: 'Recently resolved' },
];

export class PluginReconciliationComponent extends LitElement {
  static properties = {
    selectedQueue: { state: true },
  };

  static styles = css`
    :host {
      display: block;
      width: min(760px, calc(100vw - 64px));
      color: var(--color-sidebar-text, white);
      font-family: inherit;
    }
    header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
    h2 { margin: 0; font-size: 16px; font-weight: 600; }
    h3 { margin: 0 0 16px; font-size: 14px; font-weight: 600; }
    .availability { font-size: 12px; opacity: 0.7; }
    button {
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      min-height: 32px;
      padding: 6px 10px;
      cursor: pointer;
      text-align: left;
    }
    button:focus-visible { outline: 2px solid #8ec8ff; outline-offset: 2px; }
    .close { margin-left: auto; border-color: currentColor; }
    .workspace { display: grid; grid-template-columns: 220px minmax(0, 1fr); }
    .queues { display: flex; flex-direction: column; gap: 4px; padding-right: 16px; }
    .queues button { font-size: 13px; overflow-wrap: anywhere; }
    .queues button:hover { background: rgba(255, 255, 255, 0.06); }
    .queues button[aria-pressed='true'] {
      background: rgba(142, 200, 255, 0.12);
      border-color: #8ec8ff;
    }
    .detail {
      min-height: 300px;
      padding: 8px 0 8px 20px;
      border-left: 1px solid rgba(255, 255, 255, 0.2);
      overflow-wrap: anywhere;
    }
    .empty { display: grid; place-items: center; min-height: 240px; }
    .empty p { margin: 0; opacity: 0.7; font-size: 13px; text-align: center; }
  `;

  constructor() {
    super();
    this.selectedQueue = QUEUES[0].id;
  }

  _onQueueSelect(queueId) {
    this.selectedQueue = queueId;
  }

  _onClose() {
    this.dispatchEvent(new CustomEvent('menu-close', { bubbles: true, composed: true }));
  }

  render() {
    const queue = QUEUES.find((entry) => entry.id === this.selectedQueue);
    return html`
      <header>
        <h2>Reconciliation</h2>
        <span class="availability">Not connected</span>
        <button class="close" @click=${this._onClose}>Close</button>
      </header>
      <div class="workspace">
        <nav class="queues" aria-label="Reconciliation queues">
          ${QUEUES.map((entry) => html`
            <button
              aria-pressed=${this.selectedQueue === entry.id ? 'true' : 'false'}
              aria-controls="queue-detail"
              data-queue=${entry.id}
              @click=${() => this._onQueueSelect(entry.id)}
            >${entry.label}</button>
          `)}
        </nav>
        <section class="detail" id="queue-detail" aria-labelledby="queue-heading">
          <h3 id="queue-heading">${queue.label}</h3>
          <div class="empty" role="status"><p>Reconciliation queue unavailable.</p></div>
        </section>
      </div>
    `;
  }
}

customElements.define('plugin-reconciliation-content', PluginReconciliationComponent);