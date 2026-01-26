import { LitElement, html, css } from '/static/js/vendor/lit.js';

export class AdminUsers extends LitElement{
  static styles = css`
    :host { display:block; }
    h2 { margin-top:0; font-size:1.1rem; }
    .panel { padding:12px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; }
  `;
  render(){
    return html`<section>
      <h2>Users</h2>
      <div class="panel">User management placeholder. Will list users and admin markers.</div>
    </section>`;
  }
}
customElements.define('admin-users', AdminUsers);
