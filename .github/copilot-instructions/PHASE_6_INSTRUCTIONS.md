# Phase 6: State.js Cleanup - Copilot Instructions

**Goal:** Remove legacy code, keep only delegation  
**Reduction:** 823 LOC → <200 LOC (78% reduction)  
**Duration:** 2 days

---

## Prerequisites

**CRITICAL:** Only proceed if ALL feature flags are ON and ALL tests passing:

```javascript
// www/js/config.js - ALL must be true
export const featureFlags = {
  USE_SCENARIO_SERVICE: true,    // Phase 3
  USE_FILTER_SERVICE: true,      // Phase 4
  USE_CAPACITY_SERVICE: true,    // Phase 5
  USE_BASELINE_SERVICE: true     // Phase 5
};
```

**Verify:** `npm test` → All 203 tests passing ✅

---

## Included: Phase 5.1 — FeatureService Extraction (compact)

**Rationale:** `state.js` often contains dense feature-related logic. Phase 5.1 extracts that cluster into a dedicated `FeatureService` so Phase 6 can safely remove legacy code and keep `state.js` as a thin delegator.

**Quick checklist (pre-Phase 6):**
- Add feature flag: `USE_FEATURE_SERVICE` in `www/js/config.js` (default `false`).
- Create oracle tests: `tests/oracle/test-feature-oracle.test.js` capturing legacy `features` behavior.
- Create service skeleton: `www/js/services/FeatureService.js` with public API.
- Add service unit tests: `tests/services/test-feature-service.test.js`.
- Delegate `state.js` to `FeatureService` when `USE_FEATURE_SERVICE === true` and verify parity.

**Acceptance criteria for Phase 5.1 (required before full cleanup):**
- FeatureService implemented and covered by unit tests.
- Oracle tests demonstrate parity with legacy behavior.
- `state.js` delegates feature operations when `USE_FEATURE_SERVICE` is true.
- Full test suite passes with the flag ON and OFF.

Refer to: `.github/copilot-instructions/PHASE_5_1_INSTRUCTIONS.md` and `AGENT_PHASE_5_1_GUIDE.md` for full steps and code templates.


## Step 1: Create Backup (IMPORTANT)

```bash
# Create timestamped backup
cp www/js/state.js www/js/state.js.backup.$(date +%Y%m%d_%H%M%S)

# Verify backup exists
ls -lh www/js/state.js.backup.*
```

---

## Step 2: Remove Scenario Code (Day 1)

### File: `www/js/state.js` (MODIFY)

**BEFORE (Lines 1-300):**
```javascript
const state = {
  scenarios: [],
  activeScenarioId: null,
  
  // Long implementation of scenario methods
  createScenario(name) {
    if (featureFlags.USE_SCENARIO_SERVICE) {
      return scenarioService.createScenario(name);
    } else {
      // 50 lines of legacy code
      const id = generateId();
      const scenario = {
        id,
        name,
        features: JSON.parse(JSON.stringify(this.features)),
        // ... more cloning
      };
      this.scenarios.push(scenario);
      bus.emit('scenario:created', scenario);
      return scenario;
    }
  },
  
  activateScenario(id) {
    if (featureFlags.USE_SCENARIO_SERVICE) {
      return scenarioService.activateScenario(id);
    } else {
      // 40 lines of legacy code
      const scenario = this.scenarios.find(s => s.id === id);
      if (scenario) {
        this.features = JSON.parse(JSON.stringify(scenario.features));
        // ... more restoration
        this.activeScenarioId = id;
        bus.emit('scenario:activated', scenario);
      }
    }
  },
  
  // 5 more scenario methods with if/else blocks...
};
```

**AFTER (Lines 1-50):**
```javascript
const state = {
  scenarios: [],
  activeScenarioId: null,
  
  // Clean delegation only
  createScenario(name) {
    return scenarioService.createScenario(name);
  },
  
  activateScenario(id) {
    return scenarioService.activateScenario(id);
  },
  
  deleteScenario(id) {
    return scenarioService.deleteScenario(id);
  },
  
  listScenarios() {
    return scenarioService.listScenarios();
  },
  
  updateScenario(id, data) {
    return scenarioService.updateScenario(id, data);
  },
  
  getActiveScenario() {
    return scenarioService.getActiveScenario();
  },
  
  cloneScenario(id, newName) {
    return scenarioService.cloneScenario(id, newName);
  }
};
```

**Removed:** ~250 lines of legacy scenario code

---

## Step 3: Remove Filter Code (Day 1)

**BEFORE (Lines 300-500):**
```javascript
const state = {
  selectedProjects: new Set(),
  selectedTeams: new Set(),
  stateFilters: new Set(['Active', 'New']),
  
  toggleProject(projectId) {
    if (featureFlags.USE_FILTER_SERVICE) {
      return filterManager.toggleProject(projectId);
    } else {
      // 30 lines of legacy code
      if (this.selectedProjects.has(projectId)) {
        this.selectedProjects.delete(projectId);
      } else {
        this.selectedProjects.add(projectId);
      }
      this._applyFilters();
      bus.emit('filter:project-toggled', projectId);
    }
  },
  
  // 8 more filter methods with if/else blocks...
  
  _applyFilters() {
    // 80 lines of complex filtering logic
  }
};
```

**AFTER (Lines 50-100):**
```javascript
const state = {
  selectedProjects: new Set(),
  selectedTeams: new Set(),
  stateFilters: new Set(['Active', 'New']),
  
  // Clean delegation
  toggleProject(projectId) {
    return filterManager.toggleProject(projectId);
  },
  
  toggleTeam(teamId) {
    return filterManager.toggleTeam(teamId);
  },
  
  selectAllProjects() {
    return filterManager.selectAllProjects();
  },
  
  deselectAllProjects() {
    return filterManager.deselectAllProjects();
  },
  
  selectAllTeams() {
    return filterManager.selectAllTeams();
  },
  
  deselectAllTeams() {
    return filterManager.deselectAllTeams();
  },
  
  toggleStateFilter(state) {
    return filterManager.toggleStateFilter(state);
  },
  
  applyFilters() {
    return filterManager.applyFilters();
  },
  
  getFilteredFeatures() {
    return filterManager.getFilteredFeatures();
  }
};
```

**Removed:** ~200 lines of legacy filter code

---

## Step 4: Remove Capacity Code (Day 2)

**BEFORE (Lines 500-700):**
```javascript
const state = {
  calculateCapacity() {
    if (featureFlags.USE_CAPACITY_SERVICE) {
      return capacityCalculator.calculate(this.features, this.teams);
    } else {
      // 100+ lines of complex capacity calculation
      const dateRange = this._generateDateRange(this.features);
      const totalCapacity = 0;
      
      for (const date of dateRange) {
        for (const team of this.teams) {
          totalCapacity += team.capacity || 0;
        }
      }
      
      // ... 90 more lines of calculation logic
    }
  },
  
  _generateDateRange(features) {
    // 40 lines
  },
  
  _calculateTeamCapacity(team, dateRange) {
    // 30 lines
  },
  
  // 4 more helper methods...
};
```

**AFTER (Lines 100-120):**
```javascript
const state = {
  calculateCapacity() {
    return capacityCalculator.calculate(this.features, this.teams);
  },
  
  getCapacityByTeam() {
    const result = capacityCalculator.calculate(this.features, this.teams);
    return result.byTeam;
  },
  
  getCapacityByProject() {
    const result = capacityCalculator.calculate(this.features, this.teams);
    return result.byProject;
  }
};
```

**Removed:** ~180 lines of legacy capacity code

---

## Step 5: Remove Baseline Code (Day 2)

**BEFORE (Lines 700-823):**
```javascript
const state = {
  baselines: new Map(),
  
  captureBaseline(name = 'default') {
    if (featureFlags.USE_BASELINE_SERVICE) {
      // delegation
    } else {
      // 40 lines of legacy baseline capture
      const snapshot = {
        features: JSON.parse(JSON.stringify(this.features)),
        teams: JSON.parse(JSON.stringify(this.teams)),
        // ... more cloning
        timestamp: Date.now()
      };
      this.baselines.set(name, snapshot);
      bus.emit('baseline:captured', { name, snapshot });
      return snapshot;
    }
  },
  
  restoreBaseline(name = 'default') {
    if (featureFlags.USE_BASELINE_SERVICE) {
      // delegation
    } else {
      // 50 lines of legacy baseline restoration
      const snapshot = this.baselines.get(name);
      if (snapshot) {
        this.features = JSON.parse(JSON.stringify(snapshot.features));
        // ... more restoration
        bus.emit('baseline:restored', { name, snapshot });
      }
    }
  },
  
  // 3 more baseline methods...
};
```

**AFTER (Lines 120-150):**
```javascript
const state = {
  captureBaseline(name = 'default') {
    const snapshot = {
      features: JSON.parse(JSON.stringify(this.features)),
      teams: JSON.parse(JSON.stringify(this.teams)),
      projects: JSON.parse(JSON.stringify(this.projects))
    };
    baselineStore.save(name, snapshot);
    return snapshot;
  },
  
  restoreBaseline(name = 'default') {
    const snapshot = baselineStore.load(name);
    if (snapshot) {
      this.features = snapshot.features;
      this.teams = snapshot.teams;
      this.projects = snapshot.projects;
      bus.emit('baseline:restored', snapshot);
    }
  },
  
  listBaselines() {
    return baselineStore.list();
  },
  
  deleteBaseline(name) {
    return baselineStore.delete(name);
  }
};
```

**Removed:** ~120 lines of legacy baseline code

---

## Step 6: Verify Final State

### File: `www/js/state.js` (FINAL - ~180 LOC)

```javascript
import { bus } from './eventBus.js';
import { scenarioService } from './services/ScenarioService.js';
import { filterManager } from './services/FilterManager.js';
import { capacityCalculator } from './services/CapacityCalculator.js';
import { baselineStore } from './services/BaselineStore.js';

const state = {
  // Core data
  features: [],
  teams: [],
  projects: [],
  scenarios: [],
  activeScenarioId: null,
  selectedProjects: new Set(),
  selectedTeams: new Set(),
  stateFilters: new Set(['Active', 'New']),
  
  // Scenario methods (delegation only)
  createScenario(name) { return scenarioService.createScenario(name); },
  activateScenario(id) { return scenarioService.activateScenario(id); },
  deleteScenario(id) { return scenarioService.deleteScenario(id); },
  listScenarios() { return scenarioService.listScenarios(); },
  updateScenario(id, data) { return scenarioService.updateScenario(id, data); },
  getActiveScenario() { return scenarioService.getActiveScenario(); },
  cloneScenario(id, newName) { return scenarioService.cloneScenario(id, newName); },
  
  // Filter methods (delegation only)
  toggleProject(projectId) { return filterManager.toggleProject(projectId); },
  toggleTeam(teamId) { return filterManager.toggleTeam(teamId); },
  selectAllProjects() { return filterManager.selectAllProjects(); },
  deselectAllProjects() { return filterManager.deselectAllProjects(); },
  selectAllTeams() { return filterManager.selectAllTeams(); },
  deselectAllTeams() { return filterManager.deselectAllTeams(); },
  toggleStateFilter(state) { return filterManager.toggleStateFilter(state); },
  applyFilters() { return filterManager.applyFilters(); },
  getFilteredFeatures() { return filterManager.getFilteredFeatures(); },
  
  // Capacity methods (delegation only)
  calculateCapacity() { return capacityCalculator.calculate(this.features, this.teams); },
  getCapacityByTeam() { return capacityCalculator.calculate(this.features, this.teams).byTeam; },
  getCapacityByProject() { return capacityCalculator.calculate(this.features, this.teams).byProject; },
  
  // Baseline methods (delegation only)
  captureBaseline(name = 'default') {
    const snapshot = {
      features: JSON.parse(JSON.stringify(this.features)),
      teams: JSON.parse(JSON.stringify(this.teams)),
      projects: JSON.parse(JSON.stringify(this.projects))
    };
    baselineStore.save(name, snapshot);
    return snapshot;
  },
  
  restoreBaseline(name = 'default') {
    const snapshot = baselineStore.load(name);
    if (snapshot) {
      this.features = snapshot.features;
      this.teams = snapshot.teams;
      this.projects = snapshot.projects;
      bus.emit('baseline:restored', snapshot);
    }
  },
  
  listBaselines() { return baselineStore.list(); },
  deleteBaseline(name) { return baselineStore.delete(name); }
};

export { state };
```

**Final Metrics:**
- Before: 823 LOC
- After: ~180 LOC
- Reduction: 78% fewer lines
- All functionality preserved

---

## Step 7: Run All Tests

```bash
npm test
```

**Expected:** All 203 tests passing ✅

If any tests fail:
1. Check imports at top of state.js
2. Verify all services are exported correctly
3. Ensure feature flags are ON
4. Check browser console for errors

---

## Step 8: Manual Testing

### Test Every Feature
1. Load app
2. Create scenario
3. Activate scenario
4. Toggle project filters
5. Toggle team filters
6. Toggle state filters
7. Check capacity calculations
8. Capture baseline
9. Restore baseline
10. Delete scenario

All should work identically to before cleanup.

---

## Acceptance Criteria

- [ ] state.js reduced from 823 → ~180 LOC (78% reduction)
- [ ] All feature flags removed from state.js
- [ ] Only delegation code remains
- [ ] All 203 tests still passing
- [ ] No console errors
- [ ] All features work in app
- [ ] Backup file created
- [ ] Code is clean and readable

---

## Rollback Plan

If anything breaks:

```bash
# Restore backup
cp www/js/state.js.backup.YYYYMMDD_HHMMSS www/js/state.js

# Verify tests pass
npm test
```

---

## Next: Phase 7 - Plugin Manager
