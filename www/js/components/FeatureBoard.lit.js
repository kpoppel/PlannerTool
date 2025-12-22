import { LitElement, html, css } from '../vendor/lit.js';

class FeatureBoard extends LitElement {
  static properties = {
    features: { type: Array }
  };

  constructor() {
    super();
    this.features = [];
  }

  static styles = css`
    :host {
      display: block;
      flex: 1;
      position: relative;
      overflow: auto;
      padding: 0;
      /* Alternating month background aligned with card lanes */
      background:
        repeating-linear-gradient(to right,
          var(--color-bg, #f7f7f7) 0,
          var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
          var(--color-month-alt, #ececec) var(--timeline-month-width, 120px),
          var(--color-month-alt, #ececec) calc(var(--timeline-month-width, 120px) * 2)
        );
      background-position: 0 0; /* align stripes with card origin */
    }

    :host(.scenario-mode) {
      background:
        repeating-linear-gradient(to right,
          var(--color-bg, #f7f7f7) 0,
          var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
          var(--color-month-alt-scenario, #e2e2e2) var(--timeline-month-width, 120px),
          var(--color-month-alt-scenario, #e2e2e2) calc(var(--timeline-month-width, 120px) * 2)
        );
      background-position: 0 0;
    }
  `;

  // Use shadow DOM so component-scoped `static styles` apply.
  // Render a slot so any existing light-DOM children (or imperative
  // appendChild calls) will still be projected into the component.

  connectedCallback(){
    super.connectedCallback();
    // Ensure accessible role is present on the host element
    try{ if(!this.hasAttribute('role')) this.setAttribute('role','list'); }catch(e){}
  }

  render(){
    // Keep rendering minimal — project any light-dom children into slot.
    return html`<slot></slot>`;
  }

  _selectFeature(feature){
    this.dispatchEvent(new CustomEvent('feature-selected', { detail: { feature }, bubbles: true, composed: true }));
  }

  // Convenience: append a DOM node or feature data (callers may use this)
  addFeature(nodeOrFeature){
    if(!nodeOrFeature) return;
    try{
      if(nodeOrFeature instanceof Node){ this.appendChild(nodeOrFeature); }
      else {
        const div = document.createElement('div'); div.className = 'feature'; div.setAttribute('role','listitem'); div.textContent = nodeOrFeature.title || 'Untitled'; this.appendChild(div);
      }
    }catch(e){}
  }
}

customElements.define('feature-board', FeatureBoard);
