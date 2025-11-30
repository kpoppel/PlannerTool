import { bus } from './eventBus.js';
import { getLocalPref, setLocalPref } from './dataLocalStorageService.js';
import { dataService } from './dataService.js';

function ensureModal(){
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
          <input type="password" id="configPat" placeholder="••••••••" required />
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

export function openConfigModal(){
  const modal = ensureModal();
  modal.style.display = 'flex';
  const emailInput = modal.querySelector('#configEmail');
  const patInput = modal.querySelector('#configPat');
  const form = modal.querySelector('#configForm');
  const status = modal.querySelector('#configStatus');
  const closeBtn = modal.querySelector('#closeConfigBtn');
  const autosaveInput = modal.querySelector('#autosaveInterval');

  const storedEmail = getLocalPref('user.email');
  if (storedEmail) emailInput.value = storedEmail;
  const storedAutosave = getLocalPref('autosave.interval');
  if (storedAutosave !== undefined) autosaveInput.value = storedAutosave;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const pat = patInput.value;
    const autosaveInterval = parseInt(autosaveInput.value, 10) || 0;
    if (email) setLocalPref('user.email', email);
    setLocalPref('autosave.interval', autosaveInterval);
    const patResult = await dataService.setPat(pat);
    status.textContent = 'Configuration saved. PAT stored (mocked).';
    bus.emit('config:updated', { email });
    bus.emit('config:pat:updated', { pat: patResult });
    bus.emit('config:autosave', { autosaveInterval });
  };

  closeBtn.onclick = () => { modal.style.display = 'none'; };
  modal.addEventListener('click', (e)=>{
    if(e.target === modal) modal.style.display = 'none';
  });
}
