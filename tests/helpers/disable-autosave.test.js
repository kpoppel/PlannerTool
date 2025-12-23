import { state } from '../../www/js/services/State.js';

// Prevent the State service from starting autosave intervals during tests.
before(() => {
  try{
    state.setupAutosave = function(intervalMin){
      if(this.autosaveTimer){ clearInterval(this.autosaveTimer); this.autosaveTimer = null; }
      this.autosaveIntervalMin = 0;
    };
    // Clear any timer that might already be running
    try{ state.setupAutosave(0); }catch(e){}
  }catch(e){ /* noop for environments where state isn't available */ }
});

after(() => {
  try{ state.setupAutosave(0); }catch(e){}
});
