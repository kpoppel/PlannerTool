import { LitElement, html, css } from '../vendor/lit.js';

export class PluginClostComponent extends LitElement {
  static properties = {
    visible: { type: Boolean }
  };

  constructor(){
    super();
    this.visible = false;
    this._savedMainStyles = null;
  }

  static styles = css`
    :host { display: block; position: absolute; left:0; top:0; right:0; bottom:0; z-index:50; box-sizing: border-box; }
    .container { width:100%; height:100%; display:flex; flex-direction:column; padding:12px; box-sizing:border-box; background:var(--surface, #fff); }
    table { border-collapse: collapse; width:100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f4f4f4; }
  `;

  render(){
    return html`
      <div class="container" role="dialog" aria-modal="true">
        <h3>Plugin Cost (placeholder)</h3>
        <table>
          <thead>
            <tr><th>Item</th><th>Estimated Cost</th><th>Notes</th></tr>
          </thead>
          <tbody>
            <tr><td>Feature A</td><td>$1,200</td><td>Placeholder</td></tr>
            <tr><td>Feature B</td><td>$800</td><td>Placeholder</td></tr>
            <tr><td>Total</td><td>$2,000</td><td>-</td></tr>
          </tbody>
        </table>
      </div>
    `;
  }

  open(){
    const main = document.querySelector('main');
    if(main && !this._savedMainStyles){
      this._savedMainStyles = [];
      Array.from(main.children).forEach(child=>{ if(child === this) return; this._savedMainStyles.push({ el: child, display: child.style.display || '' }); child.style.display = 'none'; });
    }
    this.style.display = 'block';
  }

  close(){
    this.style.display = 'none';
    const main = document.querySelector('main');
    if(main && this._savedMainStyles){
      this._savedMainStyles.forEach(s=>{ s.el.style.display = s.display; });
      this._savedMainStyles = null;
    }
  }
}

customElements.define('plugin-cost', PluginClostComponent);
