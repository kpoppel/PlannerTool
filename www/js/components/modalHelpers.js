// Lightweight helpers to open common modal components.
// Helpers dynamically import the module, create or reuse an element,
// wait for user action events, then cleanup and resolve with a value.

export async function openConfigModal({ parent = document.body } = {}){
  await import('./ConfigModal.lit.js');
  let el = parent.querySelector('config-modal');
  let created = false;
  if(!el){ el = document.createElement('config-modal'); created = true; parent.appendChild(el); }
  try{ if(el.updateComplete) await el.updateComplete; }catch(e){}
  const inner = el.querySelector('modal-lit'); if(inner) inner.open = true;
  return new Promise((resolve)=>{
    const onClose = (e)=>{ cleanup(); resolve(e?.detail || null); };
    function cleanup(){ try{ el.removeEventListener('modal-close', onClose); }catch(e){}; if(created){ try{ el.remove(); }catch(e){} } }
    el.addEventListener('modal-close', onClose);
  });
}

export async function openHelpModal({ parent = document.body } = {}){
  await import('./HelpModal.lit.js');
  let el = document.createElement('help-modal');
  parent.appendChild(el);
  try{ if(el.updateComplete) await el.updateComplete; }catch(e){}
  return new Promise((resolve)=>{
    const onClose = (e)=>{ cleanup(); resolve(e?.detail || null); };
    function cleanup(){ try{ el.removeEventListener('modal-close', onClose); }catch(e){}; try{ el.remove(); }catch(e){} }
    el.addEventListener('modal-close', onClose);
  });
}

export async function openAzureDevopsModal({ overrides = {}, state = null, parent = document.body } = {}){
  await import('./AzureDevopsModal.lit.js');
  let el = parent.querySelector('azure-devops-modal');
  let created = false;
  if(!el){ el = document.createElement('azure-devops-modal'); created = true; parent.appendChild(el); }
  el.overrides = overrides; el.state = state;
  try{ if(el.updateComplete) await el.updateComplete; }catch(e){}
  return new Promise((resolve)=>{
    const onSave = (e) => { cleanup(); resolve(e.detail || []); };
    const onClose = () => { cleanup(); resolve(null); };
    function cleanup(){ try{ el.removeEventListener('azure-save', onSave); el.removeEventListener('modal-close', onClose); }catch(e){}; if(created){ try{ el.remove(); }catch(e){} } }
    el.addEventListener('azure-save', onSave);
    el.addEventListener('modal-close', onClose);
  });
}

export async function openScenarioCloneModal({ id, name, parent = document.body } = {}){
  await import('./ScenarioCloneModal.lit.js');
  const el = document.createElement('scenario-clone-modal');
  if(id) el.id = id; if(name) el.name = name;
  parent.appendChild(el);
  try{ if(el.updateComplete) await el.updateComplete; }catch(e){}
  return new Promise((resolve)=>{
    const onClose = (e)=>{ cleanup(); resolve(e?.detail || null); };
    function cleanup(){ try{ el.removeEventListener('modal-close', onClose); }catch(e){}; try{ el.remove(); }catch(e){} }
    el.addEventListener('modal-close', onClose);
  });
}

export async function openScenarioRenameModal({ id, name, parent = document.body } = {}){
  await import('./ScenarioRenameModal.lit.js');
  const el = document.createElement('scenario-rename-modal');
  if(id) el.id = id; if(name) el.name = name;
  parent.appendChild(el);
  try{ if(el.updateComplete) await el.updateComplete; }catch(e){}
  return new Promise((resolve)=>{
    const onClose = (e)=>{ cleanup(); resolve(e?.detail || null); };
    function cleanup(){ try{ el.removeEventListener('modal-close', onClose); }catch(e){}; try{ el.remove(); }catch(e){} }
    el.addEventListener('modal-close', onClose);
  });
}

export async function openScenarioDeleteModal({ id, name, parent = document.body } = {}){
  await import('./ScenarioDeleteModal.lit.js');
  const el = document.createElement('scenario-delete-modal');
  if(id) el.id = id; if(name) el.name = name;
  parent.appendChild(el);
  try{ if(el.updateComplete) await el.updateComplete; }catch(e){}
  return new Promise((resolve)=>{
    const onClose = (e)=>{ cleanup(); resolve(e?.detail || null); };
    function cleanup(){ try{ el.removeEventListener('modal-close', onClose); }catch(e){}; try{ el.remove(); }catch(e){} }
    el.addEventListener('modal-close', onClose);
  });
}
