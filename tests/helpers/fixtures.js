/**
 * Test Fixtures - Mock Data Generators
 * Use these to create consistent test data
 */

/**
 * Create a mock project
 */
export function createMockProject(overrides = {}) {
  return {
    id: 'proj-001',
    name: 'Test Project',
    team: 'Alpha Team',
    enabled: true,
    ...overrides
  };
}

/**
 * Create a mock team
 */
export function createMockTeam(overrides = {}) {
  return {
    id: 'team-001',
    name: 'Alpha Team',
    members: [],
    capacity: 100,
    ...overrides
  };
}

/**
 * Create a mock feature
 */
export function createMockFeature(overrides = {}) {
  return {
    id: 'feat-001',
    name: 'Test Feature',
    project: 'proj-001',
    team: 'team-001',
    start: '2024-01-01',
    end: '2024-01-31',
    effort: 10,
    dependencies: [],
    ...overrides
  };
}

/**
 * Create a mock scenario
 */
export function createMockScenario(overrides = {}) {
  return {
    id: 'scenario-001',
    name: 'Test Scenario',
    features: [],
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Create a mock state object
 */
export function createMockState() {
  return {
    scenarios: new Map(),
    currentScenario: null,
    projects: new Map(),
    teams: new Map(),
    features: new Map(),
    filters: new Set(),
    selectedFeatures: new Set()
  };
}
