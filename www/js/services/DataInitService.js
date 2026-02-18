import {
  FeatureEvents,
  ScenarioEvents,
  ProjectEvents,
  TeamEvents,
  CapacityEvents,
  StateFilterEvents
} from '../core/EventRegistry.js';

/**
 * DataInitService
 * 
 * Manages initialization and refresh of baseline data.
 * Coordinates loading data from dataService, building lookup maps,
 * and initializing dependent services.
 */
export class DataInitService {
  constructor(bus, dataService, baselineStore, projectTeamService, stateFilterService, colorService) {
    this._bus = bus;
    this._dataService = dataService;
    this._baselineStore = baselineStore;
    this._projectTeamService = projectTeamService;
    this._stateFilterService = stateFilterService;
    this._colorService = colorService;
    
    // Lookup maps
    this.baselineFeatureById = new Map();
    this.childrenByEpic = new Map();
  }

  /**
   * Initialize state with baseline data from backend
   * @returns {Object} - Object containing baselineProjects, baselineTeams, baselineFeatures
   */
  async initState() {
    const projects = await this._dataService.getProjects();
    const teams = await this._dataService.getTeams();
    const features = await this._dataService.getFeatures();
    
    // Store baseline data using BaselineStore service
    this._baselineStore.loadBaseline({ projects, teams, features });
    
    // Get baseline data
    const baselineProjects = this._baselineStore.getProjects();
    const baselineTeams = this._baselineStore.getTeams();
    let baselineFeatures = this._baselineStore.getFeatures();
    
    // Add originalRank to features
    baselineFeatures.forEach((f, i) => { f.originalRank = i; });
    
    // Build lookup maps for fast updates
    this._buildLookupMaps(baselineFeatures);
    
    // Initialize ProjectTeamService with working copies
    this._projectTeamService.initFromBaseline(baselineProjects, baselineTeams);
    
    // Precompute orgLoad on baseline features based on current team selection
    baselineFeatures = baselineFeatures.map(f => ({
      ...f,
      orgLoad: this._projectTeamService.computeFeatureOrgLoad(f)
    }));
    
    // Update baseline store with orgLoad
    try {
      this._baselineStore.setFeatures(baselineFeatures);
    } catch (e) {
      /* noop on failure */
    }
    
    // Compute available states from baseline features and initialize state filter
    const discoveredStates = Array.from(
      new Set(baselineFeatures.map(f => f.status || f.state).filter(x => !!x))
    );
    this._stateFilterService.setAvailableStates(discoveredStates);
    
    // Initialize colors
    await this._colorService.initColors(
      this._projectTeamService.getProjects(),
      this._projectTeamService.getTeams()
    );
    
    // Emit initial events
    this._bus.emit(ProjectEvents.CHANGED, this._projectTeamService.getProjects());
    this._bus.emit(TeamEvents.CHANGED, this._projectTeamService.getTeams());
    this._bus.emit(StateFilterEvents.CHANGED, this._stateFilterService.availableFeatureStates);
    this._bus.emit(FeatureEvents.UPDATED);
    
    return {
      baselineProjects,
      baselineTeams,
      baselineFeatures
    };
  }

  /**
   * Refresh baseline data from backend
   * Preserves selection state from ProjectTeamService
   * @returns {Object} - Object containing refreshed baseline data
   */
  async refreshBaseline() {
    // Invalidate server cache to force fresh data fetch
    console.log('Invalidating server cache before refresh...');
    try {
      await this._dataService.invalidateCache();
      console.log('Server cache invalidated successfully');
    } catch (e) {
      console.warn('Failed to invalidate server cache, proceeding with refresh:', e);
    }
    
    // Fetch fresh data from backend
    const projects = await this._dataService.getProjects();
    const teams = await this._dataService.getTeams();
    const features = await this._dataService.getFeatures();
    
    // Build features with originalRank first
    const featuresWithRank = features.map((f, i) => ({ ...f, originalRank: i }));
    this._baselineStore.loadBaseline({ projects, teams, features: featuresWithRank });
    
    // Get baseline data
    const baselineProjects = this._baselineStore.getProjects();
    const baselineTeams = this._baselineStore.getTeams();
    let baselineFeatures = this._baselineStore.getFeatures();
    
    // Refresh working copies in ProjectTeamService (preserves selection)
    this._projectTeamService.refreshFromBaseline(baselineProjects, baselineTeams);
    
    // Add orgLoad to features
    baselineFeatures = baselineFeatures.map(f => ({
      ...f,
      orgLoad: this._projectTeamService.computeFeatureOrgLoad(f)
    }));
    
    try {
      this._baselineStore.setFeatures(baselineFeatures);
    } catch (e) {
      /* noop on failure */
    }
    
    // Rebuild lookup maps
    this._buildLookupMaps(baselineFeatures);
    
    // Freeze baseline copies after all modifications are complete
    Object.freeze(baselineProjects);
    Object.freeze(baselineTeams);
    Object.freeze(baselineFeatures);
    
    // Recompute available states and update state filter service
    const discoveredStates = Array.from(
      new Set(baselineFeatures.map(f => f.status || f.state).filter(x => !!x))
    );
    this._stateFilterService.setAvailableStates(discoveredStates);
    
    console.log('Re-initializing colors after baseline refresh');
    await this._colorService.initColors(
      this._projectTeamService.getProjects(),
      this._projectTeamService.getTeams()
    );
    
    // Emit refresh events
    this._bus.emit(ProjectEvents.CHANGED, this._projectTeamService.getProjects());
    this._bus.emit(TeamEvents.CHANGED, this._projectTeamService.getTeams());
    this._bus.emit(FeatureEvents.UPDATED);
    
    return {
      baselineProjects,
      baselineTeams,
      baselineFeatures
    };
  }

  /**
   * Build lookup maps for features
   * @private
   * @param {Array} features - Array of feature objects
   */
  _buildLookupMaps(features) {
    this.baselineFeatureById = new Map(features.map(f => [f.id, f]));
    this.childrenByEpic = new Map();
    
    for (const f of features) {
      if (f.parentEpic) {
        if (!this.childrenByEpic.has(f.parentEpic)) {
          this.childrenByEpic.set(f.parentEpic, []);
        }
        this.childrenByEpic.get(f.parentEpic).push(f.id);
      }
    }
  }

  /**
   * Get baseline feature by ID
   * @param {string} id - Feature ID
   * @returns {Object|undefined} - Feature object or undefined
   */
  getBaselineFeatureById(id) {
    return this.baselineFeatureById.get(id);
  }

  /**
   * Get children IDs for an epic
   * @param {string} epicId - Epic ID
   * @returns {Array<string>} - Array of child feature IDs
   */
  getChildrenByEpic(epicId) {
    return this.childrenByEpic.get(epicId) || [];
  }

  /**
   * Get the childrenByEpic map
   * @returns {Map} - Map of epic IDs to child feature IDs
   */
  getChildrenByEpicMap() {
    return this.childrenByEpic;
  }
}
