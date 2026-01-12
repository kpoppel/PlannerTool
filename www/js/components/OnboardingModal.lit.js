import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';

export class OnboardingModal extends LitElement {
  static properties = { open: { type: Boolean } };

  static styles = css`
    :host { display: contents; }
    .content { font-size:14px; color:#222; padding:8px; max-height:70vh; overflow:auto; }
    .steps { margin:8px 0 12px 0; }
    .step { margin:6px 0; }
    .feature-list { columns:2; gap:12px; }
    .modal-footer { display:flex; justify-content:space-between; align-items:center; }
    .right { display:flex; gap:8px; }
  `;

  constructor(){
    super();
    this.open = false;
    this._onModalClose = this._onModalClose.bind(this);
  }

  firstUpdated(){
    this.addEventListener('modal-close', this._onModalClose);
    // open inner modal after render
    const inner = this.renderRoot.querySelector('modal-lit'); if(inner) inner.open = true;
  }

  disconnectedCallback(){
    super.disconnectedCallback();
    this.removeEventListener('modal-close', this._onModalClose);
  }

  _onModalClose(){ this.remove(); }

  _dontShowAgain(){
    try{ localStorage.setItem('az_planner:onboarding_seen', '1'); }catch(e){}
    const inner = this.renderRoot.querySelector('modal-lit'); if(inner) inner.close(); else this.remove();
  }

  render(){
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Welcome to AZ Planner</h3></div>
        <div class="content">
          <div>
            <strong>What is it</strong>
            <div class="steps">
              <div class="step">A tool that extracts Epics and Features from Azure DevOps and visualises them for strategic planning. It is not a second database.</div>
            </div>
          </div>

          <div>
            <strong>Who made it / Contact</strong>
            <div class="steps">
              <div class="step">Github: kpoppel as a passion project. Report bugs or request improvements on <a href="https://github.com/kpoppel/PlannerTool" target="_blank" rel="noopener">GitHub</a>.</div>
            </div>
          </div>

          <div>
            <strong>How to get started</strong>
            <div class="steps">
              <div class="step">1. Get a Personal Access Token (PAT): "https://dev.azure.com/&lt;YourOrg&gt;/_usersSettings/tokens"</div>
              <div class="step">2. Create a new token and give it <em>Work Items</em> scope (Read, Write, manage). Set expiry to 1 year and save the token securely.</div>
              <div class="step">3. Click the Gear in the lower left to open Configuration, enter your email and paste the PAT, then Save. Refresh the browser.</div>
            </div>
          </div>

          <div>
            <strong>Key features</strong>
            <div class="feature-list">
              <div>- Baseline snapshots from Azure DevOps</div>
              <div>- Scenario planning & push changes back to ADO</div>
              <div>- Team capacity allocations per Epic/Feature</div>
              <div>- Augmented task descriptions with capacity info</div>
              <div>- Extensive filtering and 5 zoom levels</div>
              <div>- Dependency links & allocation highlights</div>
              <div>- Large graph with SVG/PNG export</div>
              <div>- Annotation overlay saved in browser storage</div>
              <div>- Filters and selections persist between sessions</div>
            </div>
          </div>

          <div style="margin-top:12px; font-size:13px; color:#444">Play around — you can change anything and try features freely.</div>
        </div>
        <div slot="footer" class="modal-footer">
          <div>
            <button class="secondary" @click=${this._dontShowAgain}>Don't show again</button>
          </div>
          <div class="right">
            <button @click=${()=>{ const inner = this.renderRoot.querySelector('modal-lit'); if(inner) inner.close(); else this.remove(); }}>Close</button>
          </div>
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('onboarding-modal', OnboardingModal);
