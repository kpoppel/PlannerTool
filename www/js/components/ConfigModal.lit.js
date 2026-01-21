import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import './Modal.lit.js';
import { ConfigEvents } from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';

class ConfigModal extends LitElement {
  static properties = {
    open: { type: Boolean }
  };

  constructor(){
    super();
    this.open = false;
  }

  // Render into light DOM so existing global CSS applies
  createRenderRoot(){ return this; }

  connectedCallback(){
    super.connectedCallback();
  }

  disconnectedCallback(){ super.disconnectedCallback(); }

  async _populate(){
    const emailInput = this.querySelector('#configEmail');
    const autosaveInput = this.querySelector('#autosaveInterval');
    try{
      const storedEmail = await dataService.getLocalPref('user.email');
      if(storedEmail) emailInput.value = storedEmail;
      const storedAutosave = await dataService.getLocalPref('autosave.interval');
      if(storedAutosave !== undefined && autosaveInput) autosaveInput.value = storedAutosave;
    }catch(e){ /* ignore */ }
  }

  render(){
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Configuration</h3></div>
        <div>
          <form id="configForm" class="config-form">
            <div class="form-row">
              <label for="configEmail">Email address</label>
              <input type="email" id="configEmail" placeholder="you@example.com" required />
            </div>
            <div class="form-row">
              <label for="configPat">Personal Access Token (PAT)</label>
              <input type="password" id="configPat" placeholder="••••••••" />
            </div>
            <div class="form-row">
              <label for="autosaveInterval">Autosave interval (minutes, 0=off)</label>
              <input type="number" id="autosaveInterval" min="0" max="120" step="1" value="0" />
            </div>
            <div id="configStatus" class="status" aria-live="polite"></div>
          </form>
        </div>
        <div slot="footer" class="modal-footer">
          <button id="saveConfigBtn" class="btn primary">Save</button>
          <button id="closeConfigBtn" class="btn">Close</button>
        </div>
      </modal-lit>
    `;
  }

  firstUpdated(){
    // Populate now that the element has rendered and inputs are present
    this._populate();

    const form = this.querySelector('#configForm');
    const closeBtn = this.querySelector('#closeConfigBtn');
    const status = this.querySelector('#configStatus');
    const emailInput = this.querySelector('#configEmail');
    const patInput = this.querySelector('#configPat');
    const autosaveInput = this.querySelector('#autosaveInterval');

    // Save handler wired to Save button so the footer button can trigger form submit
    const saveBtn = this.querySelector('#saveConfigBtn');
    saveBtn.addEventListener('click', async (e)=>{
      e.preventDefault();
      const email = emailInput.value.trim();
      const pat = patInput.value;
      const autosaveInterval = parseInt(autosaveInput.value, 10) || 0;
      if (email) await dataService.setLocalPref('user.email', email);
      await dataService.setLocalPref('autosave.interval', autosaveInterval);
      let patText = '';
      if (pat) patText = 'Access token updated.';
      try{
        const res = await dataService.saveConfig({ email, pat });
        if(res && res.ok){ status.textContent = 'Configuration saved. ' + patText; }
        else { status.textContent = 'Configuration saved locally, but server save failed.'; }
      }catch(err){ status.textContent = 'Configuration saved locally, but server save failed.'; }
      bus.emit(ConfigEvents.UPDATED, { email });
      bus.emit(ConfigEvents.AUTOSAVE, { autosaveInterval });
    });

    closeBtn.addEventListener('click', ()=>{
      const innerModal = this.querySelector('modal-lit');
      if(innerModal && typeof innerModal.close === 'function') innerModal.close();
      else this._close();
    });

    // Replay Tour link wiring
    const replayLink = this.querySelector('#replayTourLink');
    if(replayLink){
      replayLink.addEventListener('click', async (e)=>{
        e.preventDefault();
        try{
          const mh = await import('./modalHelpers.js');
          if(mh && typeof mh.openTour === 'function'){
            await mh.openTour();
          }
        }catch(err){ console.warn('Failed to start tour', err); }
        // Close the inner modal so the tour is visible
        const innerModal = this.querySelector('modal-lit');
        if(innerModal && typeof innerModal.close === 'function') innerModal.close();
        else this._close();
      });
    }

    // Ensure the inner modal is opened after the <modal-lit> definition is available
    customElements.whenDefined('modal-lit').then(()=>{
      const innerModal = this.querySelector('modal-lit');
      if(innerModal){
        // Remove the config-modal wrapper when the inner modal closes
        innerModal.addEventListener('modal-close', ()=> this.remove());
        try{ innerModal.open = true; }catch(e){ /* ignore */ }
      }
    }).catch(()=>{
      // If definition never arrives, still attempt to open any existing inner modal
      const innerModal = this.querySelector('modal-lit');
      if(innerModal){ try{ innerModal.open = true; }catch(e){} }
    });
    // Ensure the email input is focused when the inner modal is opened
    const tryFocusEmail = () => {
      try{
        const emailInput = this.querySelector('#configEmail');
        if(emailInput && typeof emailInput.focus === 'function'){
          // small timeout to allow any modal open animation to complete
          setTimeout(()=> emailInput.focus(), 60);
        }
      }catch(e){}
    };
    // If modal-lit exists now, focus after it's opened
    const existingInner = this.querySelector('modal-lit');
    if(existingInner){
      // If modal-lit exposes open property, watch for it or attempt immediate focus
      try{ if(existingInner.open) tryFocusEmail(); else { existingInner.addEventListener('modal-open', tryFocusEmail, { once: true }); } }catch(e){ tryFocusEmail(); }
    }
  }

  _overlayClick(e){
    if(e.target && e.target.classList && e.target.classList.contains('config-modal-overlay')){
      this._close();
    }
  }

  _close(){
    const overlay = this.querySelector('.config-modal-overlay');
    if(overlay) overlay.style.display = 'none';
    this.remove();
  }
}

customElements.define('config-modal', ConfigModal);
