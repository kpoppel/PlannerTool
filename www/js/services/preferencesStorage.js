// preferencesStorage.js
// Local preferences storage adapter injected into dataService.

export class PreferencesStorage {
  constructor(storage, prefsKey = 'az_planner:user_prefs:v1') {
    this.storage = storage;
    this.prefsKey = prefsKey;
  }

  _readPrefs() {
    const raw = this.storage.getItem(this.prefsKey);
    try {
      return raw ? JSON.parse(raw) : { projectColors: {}, teamColors: {} };
    } catch {
      return { projectColors: {}, teamColors: {} };
    }
  }

  _writePrefs(data) {
    this.storage.setItem(this.prefsKey, JSON.stringify(data));
  }

  async loadColors() {
    const data = this._readPrefs();
    return {
      projectColors: data.projectColors || {},
      teamColors: data.teamColors || {},
    };
  }

  async clearAll() {
    this._writePrefs({ projectColors: {}, teamColors: {} });
  }

  async saveProjectColor(id, color) {
    const data = this._readPrefs();
    data.projectColors = data.projectColors || {};
    data.projectColors[id] = color;
    this._writePrefs(data);
  }

  async saveTeamColor(id, color) {
    const data = this._readPrefs();
    data.teamColors = data.teamColors || {};
    data.teamColors[id] = color;
    this._writePrefs(data);
  }

  async getLocalPref(key) {
    const data = this._readPrefs();
    return data[key];
  }

  async setLocalPref(key, value) {
    const data = this._readPrefs();
    data[key] = value;
    this._writePrefs(data);
  }
}
