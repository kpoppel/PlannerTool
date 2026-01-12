import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';

/**
 * help-modal - small Lit wrapper that composes `modal-lit` and fetches /static/docs/help.md
 */
export class HelpModal extends LitElement {
  static properties = {
    open: { type: Boolean }
  };

  static styles = css`
    :host { display: contents; }
    .help-content { font-size:14px; color:#222; padding:6px 4px; max-height:60vh; overflow:auto; white-space:pre-wrap; font-family: monospace; }
    .modal-footer { display:flex; justify-content:flex-end; }
  `;

  constructor(){
    super();
    this.open = false;
    this.content = 'Loading...';
    this._onModalClose = this._onModalClose.bind(this);
  }

  connectedCallback(){
    super.connectedCallback();
    this._fetchHelp();
  }

  firstUpdated(){
    // listen for modal-close from inner modal-lit
    // attach event on host after it's in DOM; use delegated listener on host
    this.addEventListener('modal-close', this._onModalClose);
    // footer wiring is handled after content fetch when modal is opened
  }

  disconnectedCallback(){
    super.disconnectedCallback();
    this.removeEventListener('modal-close', this._onModalClose);
  }

  async _fetchHelp(){
    try{
      const res = await fetch('/static/docs/help.md');
      if(res.ok){ this.content = await res.text(); }
      else { this.content = `Failed to load help (status ${res.status})`; }
    }catch(err){ this.content = 'Could not load help page.'; }
    // ensure component updates then open inner modal so final content size is applied
    await this.updateComplete;
    this.requestUpdate();
    const innerModal = this.renderRoot.querySelector('modal-lit');
    if(innerModal){
      innerModal.open = true;
      // wire footer button to close via modal-lit so event composes
      // create a Replay Tour button in the footer and wire it
      const footerSlot = this.renderRoot.querySelector('[slot="footer"]');
      if(footerSlot){
        // Clear existing footer content and add buttons
        footerSlot.innerHTML = '';
        const replay = document.createElement('button');
        replay.id = 'helpReplayTour';
        replay.className = 'btn';
        replay.textContent = 'Replay Tour';
        replay.addEventListener('click', async (e)=>{
          e.preventDefault();
          try{
            const mh = await import('./modalHelpers.js');
            if(mh && typeof mh.openTour === 'function') await mh.openTour();
          }catch(err){ console.warn('Failed to start tour', err); }
          try{ innerModal.close(); }catch(e){ this._close(); }
        });
        const closeBtn = document.createElement('button');
        closeBtn.className = 'btn';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', ()=>{ try{ innerModal.close(); }catch(e){ this._close(); } });
        footerSlot.appendChild(replay);
        footerSlot.appendChild(closeBtn);
      }
    }
  }

  _onModalClose(){
    this.remove();
  }

  _close(){ this.remove(); }

  render(){
    return html`
      <modal-lit ?open=${this.open} wide>
        <div slot="header"><h3>Help</h3></div>
        <div class="help-content">${this.content}</div>
        <div slot="footer" class="modal-footer"></div>
      </modal-lit>
    `;
  }
}

customElements.define('help-modal', HelpModal);
