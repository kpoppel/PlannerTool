// modal.js - Generic lightweight modal utility for simple interactions
// Provides openInputModal and openConfirmModal.
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