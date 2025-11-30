// Simple localStorage-backed persistence for user UI preferences
// Stores project and team colors keyed by IDs

const LS_KEY = 'az_planner:user_prefs:v1';

function readAll(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : { projectColors:{}, teamColors:{} };
  } catch{ return { projectColors:{}, teamColors:{} }; }
}
function writeAll(obj){
  try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch{}
}

export function loadColors(){
  const data = readAll();
  return { projectColors: data.projectColors || {}, teamColors: data.teamColors || {} };
}

export function saveProjectColor(id, color){
  const data = readAll();
  data.projectColors = data.projectColors || {};
  data.projectColors[id] = color;
  writeAll(data);
}

export function saveTeamColor(id, color){
  const data = readAll();
  data.teamColors = data.teamColors || {};
  data.teamColors[id] = color;
  writeAll(data);
}

export function clearAll(){ writeAll({ projectColors:{}, teamColors:{} }); }

// Generic key-value preferences (e.g., user.email)
export function getLocalPref(key){
  const data = readAll();
  return data[key];
}

export function setLocalPref(key, value){
  const data = readAll();
  data[key] = value;
  writeAll(data);
}
