// modal.js - Generic lightweight modal utility for simple interactions
// Provides openInputModal and openConfirmModal.
import { bus } from './eventBus.js';
import { dataService } from './dataService.js';

// Input Modal
export function openInputModal({ title='Input', message='', label='Name', defaultValue='', confirmLabel='OK', cancelLabel='Cancel', validate, onConfirm }){
  const overlay = document.createElement('div'); overlay.className='modal-overlay';
  const modal = document.createElement('div'); modal.className='modal';
  modal.innerHTML = `<h3>${escapeHtml(title)}</h3>` + (message?`<p>${escapeHtml(message)}</p>`:'');
  const field = document.createElement('div'); field.className='modal-field';
  const lab = document.createElement('label'); lab.textContent = label; field.appendChild(lab);
  const input = document.createElement('input'); input.type='text'; input.value= defaultValue; field.appendChild(input);
  const errorEl = document.createElement('div'); errorEl.className='modal-error'; errorEl.style.display='none'; field.appendChild(errorEl);
  modal.appendChild(field);
  const btnRow = document.createElement('div'); btnRow.className='modal-buttons';
  const cancelBtn = document.createElement('button'); cancelBtn.type='button'; cancelBtn.textContent = cancelLabel;
  const okBtn = document.createElement('button'); okBtn.type='button'; okBtn.textContent = confirmLabel; okBtn.className='primary';
  btnRow.appendChild(cancelBtn); btnRow.appendChild(okBtn); modal.appendChild(btnRow);
  overlay.appendChild(modal); document.body.appendChild(overlay);
  function close(){ overlay.remove(); }
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', ()=>{ const val = input.value.trim(); if(validate){ const err = validate(val); if(err){ errorEl.textContent = err; errorEl.style.display='block'; return; } }
    if(onConfirm) onConfirm(val); close(); });
  input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ okBtn.click(); } if(e.key==='Escape'){ close(); } });
  setTimeout(()=> input.focus(), 10);
  return { close };
}

// Confirmation Modal
export function openConfirmModal({ title='Confirm', message='', confirmLabel='Confirm', cancelLabel='Cancel', onConfirm }){
  const overlay = document.createElement('div'); overlay.className='modal-overlay';
  const modal = document.createElement('div'); modal.className='modal';
  modal.innerHTML = `<h3>${escapeHtml(title)}</h3>` + (message?`<p>${escapeHtml(message)}</p>`:'');
  const btnRow = document.createElement('div'); btnRow.className='modal-buttons';
  const cancelBtn = document.createElement('button'); cancelBtn.type='button'; cancelBtn.textContent = cancelLabel;
  const okBtn = document.createElement('button'); okBtn.type='button'; okBtn.textContent = confirmLabel; okBtn.className='primary';
  btnRow.appendChild(cancelBtn); btnRow.appendChild(okBtn); modal.appendChild(btnRow);
  overlay.appendChild(modal); document.body.appendChild(overlay);
  function close(){ overlay.remove(); }
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', ()=>{ if(onConfirm) onConfirm(); close(); });
  window.addEventListener('keydown', function escHandler(e){ if(e.key==='Escape'){ close(); window.removeEventListener('keydown', escHandler); }});
  return { close };
}

function escapeHtml(str){ return str.replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[s])); }

// Help Modal
export async function openHelpModal(){
  const overlay = document.createElement('div'); overlay.className='modal-overlay';
  const modal = document.createElement('div'); modal.className='modal wide-modal';
  const title = document.createElement('h3'); title.textContent = 'Help'; modal.appendChild(title);
  const content = document.createElement('div'); content.className = 'help-content'; content.style.maxHeight='60vh'; content.style.overflow='auto'; content.style.whiteSpace='pre-wrap'; content.style.fontFamily='monospace'; content.textContent = 'Loading...';
  modal.appendChild(content);
  const btnRow = document.createElement('div'); btnRow.className='modal-buttons';
  const closeBtn = document.createElement('button'); closeBtn.textContent='Close'; closeBtn.addEventListener('click', ()=>{ document.body.removeChild(overlay); });
  btnRow.appendChild(closeBtn);
  modal.appendChild(btnRow);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  try {
    const url = '/static/help.md';
    console.debug('openHelpModal: fetching', url);
    const res = await fetch(url);
    if (res.ok) {
      const txt = await res.text();
      content.textContent = txt;
    } else {
      console.error('openHelpModal: failed to fetch', url, res.status, res.statusText);
      content.textContent = `Failed to load help (status ${res.status})`;
    }
  } catch (err) {
    console.error('openHelpModal: exception fetching help', err);
    content.textContent = 'Could not load help page.';
  }
}

// Configuration Modal
function createConfigModal(){
  let modal = document.getElementById('configModal');
  if(modal) return modal;
  modal = document.createElement('div');
  modal.id = 'configModal';
  modal.className = 'config-modal-overlay';
  modal.innerHTML = `
    <div class="config-modal">
      <h2>Configuration</h2>
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
        <div class="config-actions">
          <button type="submit" id="saveConfigBtn">Save</button>
          <button type="button" id="closeConfigBtn">Close</button>
        </div>
        <div id="configStatus" class="status" aria-live="polite"></div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

export async function openConfigModal(){
  const modal = createConfigModal();
  modal.style.display = 'flex';
  const emailInput = modal.querySelector('#configEmail');
  const patInput = modal.querySelector('#configPat');
  const form = modal.querySelector('#configForm');
  const status = modal.querySelector('#configStatus');
  const closeBtn = modal.querySelector('#closeConfigBtn');
  const autosaveInput = modal.querySelector('#autosaveInterval');

  const storedEmail = await dataService.getLocalPref('user.email');
  if (storedEmail) emailInput.value = storedEmail;
    const storedAutosave = await dataService.getLocalPref('autosave.interval');
  if (storedAutosave !== undefined) autosaveInput.value = storedAutosave;

  status.textContent = '';

  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const pat = patInput.value;
    const autosaveInterval = parseInt(autosaveInput.value, 10) || 0;
    // Store email and autosave interval locally
    if (email) await dataService.setLocalPref('user.email', email);
    await dataService.setLocalPref('autosave.interval', autosaveInterval);
    let patText = '';
    if (pat) {
      patText = 'Access token updated.';
    }
    // Persist account to backend (server will store via storage backend)
    try{
      const res = await dataService.saveConfig({ email, pat });
      if(res && res.ok){
        status.textContent = 'Configuration saved. ' + patText;
      } else {
        status.textContent = 'Configuration saved locally, but server save failed.';
      }
    }catch(err){
      status.textContent = 'Configuration saved locally, but server save failed.';
    }
    bus.emit('config:updated', { email });
    bus.emit('config:autosave', { autosaveInterval });
  };

  closeBtn.onclick = () => { modal.style.display = 'none'; };
  modal.addEventListener('click', (e)=>{
    if(e.target === modal) modal.style.display = 'none';
  });
}
