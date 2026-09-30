import { LitElement, html, css } from '../vendor/lit.js';
import { sel } from '../application/imports.js';

export class SampleMenuPluginComponent extends LitElement {
  static properties = {
    plugin: { attribute: false },
  };

  static styles = css`
    :host { display: block; color: var(--color-sidebar-text, white); }
    h3 { font-size: 14px; font-weight: 600; margin: 0 0 12px; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin: 0 0 16px; }
    dt, dd { margin: 0; font-size: 13px; }
    dd { font-variant-numeric: tabular-nums; }
    .counter { display: flex; align-items: center; gap: 8px; }
    output { min-width: 4ch; text-align: center; font-variant-numeric: tabular-nums; }
    button { background: transparent; color: inherit; border: 1px solid currentColor;
      border-radius: 4px; min-height: 32px; padding: 4px 10px; cursor: pointer; }
    button:focus-visible { outline: 2px solid #8ec8ff; outline-offset: 2px; }
    .close { margin-left: auto; }
  `;

  /** @param {import('./SampleMenuPlugin.js').SampleMenuPlugin} plugin */
  constructor(plugin) {
    super();
    this.plugin = plugin;
  }

  _onIncrement() {
    this.plugin.counter += 1;
    this.requestUpdate();
  }

  _onReset() {
    this.plugin.counter = this.plugin.initialCount;
    this.requestUpdate();
  }

  _onClose() {
    this.dispatchEvent(new CustomEvent('menu-close', { bubbles: true, composed: true }));
  }

  render() {
    const funnel = sel.scope.getFunnel();
    return html`
      <h3>Planning Scope</h3>
      <dl>
        <dt>Tasks in scope</dt><dd>${funnel.tasksInScope}</dd>
        <dt>Participating teams</dt><dd>${funnel.teamsInScope}</dd>
        <dt>Visible tasks</dt><dd>${funnel.tasksVisible}</dd>
      </dl>
      <div class="counter">
        <button @click=${this._onIncrement} aria-label="Increment counter" title="Increment counter">+1</button>
        <output aria-label="Counter" aria-live="polite">${this.plugin.counter}</output>
        <button @click=${this._onReset} title="Reset counter">Reset</button>
        <button class="close" @click=${this._onClose}>Close</button>
      </div>
    `;
  }
}

customElements.define('sample-menu-plugin-content', SampleMenuPluginComponent);