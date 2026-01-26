import { LitElement, html, css } from '/static/js/vendor/lit.js';

export class AdminSystem extends LitElement{
  static styles = css`
    :host { display:block; }
    h2 { margin-top:0; font-size:1.1rem; }
    .panel { padding:12px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; }
  `;
  render(){
    return html`<section>
      <h2>System</h2>
      <div class="panel">System administration placeholder. Add controls here later.</div>
    </section>`;
  }
}
customElements.define('admin-system', AdminSystem);
