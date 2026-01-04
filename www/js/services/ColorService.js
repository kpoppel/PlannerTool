/**
 * Module: ColorService
 * Intent: Manage color mappings for projects, teams, and feature states
 * Purpose: Extract color management from State.js to centralize color logic
 * 
 * Responsibilities:
 * - Generate deterministic colors for projects, teams, and feature states
 * - Load/save persistent color mappings via dataService
 * - Provide color lookup methods
 * - Compute text colors for contrast (black/white on colored backgrounds)
 * 
 * Color Strategy:
 * - Projects/Teams: Use saved colors from backend, fallback to deterministic PALETTE selection
 * - Feature States: Use default state color map, fallback to deterministic PALETTE selection
 */

// Color palette for projects, teams, and feature states
export const PALETTE = [
  '#3498db','#2980b9','#1abc9c','#16a085',
  '#27ae60','#2ecc71','#f1c40f','#f39c12',
  '#e67e22','#d35400','#e74c3c','#c0392b',
  '#9b59b6','#8e44ad','#34495e','#7f8c8d'
];

// Default mapping from feature status/state to color
export const DEFAULT_STATE_COLOR_MAP = {
  'New': '#3498db',
  'Defined': '#2ecc71',
  'In Progress': '#f1c40f',
  'Completed': '#9b59b6',
  'Done': '#9b59b6',
  'Archived': '#7f8c8d',
  'Blocked': '#e74c3c',
  'On Hold': '#e67e22'
};

export class ColorService {
  /**
   * Create a new ColorService
   * @param {Object} dataService - Data service for loading/saving color mappings
   */
  constructor(dataService) {
    this.dataService = dataService;
    
    // Default state->color mapping (can be overridden by config later)
    this.defaultStateColorMap = DEFAULT_STATE_COLOR_MAP;
    
    // Runtime color assignments (may differ from saved mappings)
    this.projectColors = {}; // { projectId: '#hex' }
    this.teamColors = {}; // { teamId: '#hex' }
  }
  
  // ========== Color Assignment ==========
  
  /**
   * Initialize colors for projects and teams
   * Loads saved colors from backend, assigns deterministic fallbacks
   * @param {Array} projects - Array of project objects
   * @param {Array} teams - Array of team objects
   * @returns {Promise<void>}
   */
  async initColors(projects, teams) {
    const { projectColors, teamColors } = await this.dataService.getColorMappings();
    
    let pi = 0;
    let ti = 0;
    
    // Assign colors to projects
    for (const p of projects) {
      if (projectColors[p.id]) {
        p.color = projectColors[p.id];
      } else {
        p.color = PALETTE[pi % PALETTE.length];
        pi++;
      }
    }
    
    // Assign colors to teams
    for (const t of teams) {
      if (teamColors[t.id]) {
        t.color = teamColors[t.id];
      } else {
        t.color = PALETTE[ti % PALETTE.length];
        ti++;
      }
    }
    
    // Cache for runtime lookups
    this.projectColors = Object.fromEntries(projects.map(p => [p.id, p.color]));
    this.teamColors = Object.fromEntries(teams.map(t => [t.id, t.color]));
  }
  
  // ========== Color Lookup ==========
  
  /**
   * Get color for a project
   * @param {string} projectId - Project ID
   * @param {Array} [projects] - Optional project array for lookup
   * @param {Array} [baselineProjects] - Optional baseline project array for fallback
   * @returns {string} Hex color code
   */
  getProjectColor(projectId, projects = null, baselineProjects = null) {
    if (!projectId) return PALETTE[0];
    
    // Try cached color
    if (this.projectColors[projectId]) {
      return this.projectColors[projectId];
    }
    
    // Try to find in working projects array
    if (projects) {
      const p = projects.find(pr => pr.id === projectId);
      if (p && p.color) return p.color;
    }
    
    // Try to find in baseline projects array
    if (baselineProjects) {
      const bp = baselineProjects.find(pr => pr.id === projectId);
      if (bp && bp.color) return bp.color;
    }
    
    // Deterministic fallback: hash the id string to pick a palette color
    return this._hashToColor(String(projectId));
  }
  
  /**
   * Get color for a feature state
   * @param {string} stateName - Feature state name
   * @returns {string} Hex color code
   */
  getFeatureStateColor(stateName) {
    if (!stateName) return PALETTE[0];
    
    // Try default state color map first
    if (this.defaultStateColorMap[stateName]) {
      return this.defaultStateColorMap[stateName];
    }
    
    // Deterministic fallback: hash the state name to pick a palette color
    return this._hashToColor(stateName);
  }
  
  /**
   * Get color mappings for all available feature states
   * Returns { background, text } color objects for each state
   * @param {Array<string>} availableStates - List of feature state names
   * @returns {Object<string, {background: string, text: string}>}
   */
  getFeatureStateColors(availableStates) {
    const colors = {};
    const states = availableStates || [];
    
    for (const s of states) {
      const bg = this.getFeatureStateColor(s);
      colors[s] = { 
        background: bg, 
        text: this._pickTextColor(bg) 
      };
    }
    
    return colors;
  }
  
  // ========== Helper Methods ==========
  
  /**
   * Hash a string to deterministically select a color from PALETTE
   * @private
   * @param {string} str - String to hash
   * @returns {string} Hex color code
   */
  _hashToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0; // Convert to 32-bit integer
    }
    const idx = Math.abs(hash) % PALETTE.length;
    return PALETTE[idx];
  }
  
  /**
   * Pick black or white text color for readability on colored background
   * Uses YIQ formula to determine brightness
   * @private
   * @param {string} hex - Background hex color
   * @returns {string} '#000' or '#fff'
   */
  _pickTextColor(hex) {
    if (!hex) return '#000';
    
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    
    // YIQ formula to determine light/dark text
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq >= 128 ? '#000' : '#fff';
  }
}
