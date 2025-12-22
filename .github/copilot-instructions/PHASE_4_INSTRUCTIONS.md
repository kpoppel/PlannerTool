# Phase 4: FilterManager Extraction - Copilot Instructions

**Duration:** 3 days  
**Status:** Not Started  
**Prerequisites:** Phase 3 complete (ScenarioManager working)

---

## Objective

Extract filter management logic from state.js into FilterManager service using the Oracle + Service + Delegation pattern.

---

## Deliverables

1. ✅ Oracle tests capturing current filter behavior (13 tests)
2. ✅ FilterManager.js service
3. ✅ state.js delegation with USE_FILTER_SERVICE flag
4. ✅ Integration tests (flag ON/OFF)
5. ✅ 25 new tests passing (92 total)

---

## Step 1: Write Oracle Tests (CAPTURE)

**File:** `tests/services/test-filter-oracle.test.js`

Capture these current behaviors:
- `toggleProjectSelection()` toggles selected property
- `toggleProjectSelection()` emits `projects:changed`
- `selectAllProjects()` / `deselectAllProjects()`
- `toggleTeamSelection()` toggles selected property
- `toggleTeamSelection()` emits `teams:changed`
- `selectAllTeams()` / `deselectAllTeams()`
- `toggleStateFilter()` adds/removes from Set
- `toggleStateFilter()` emits `filters:changed`
- `captureCurrentFilters()` returns selected IDs

**Run:**
```bash
npm test tests/services/test-filter-oracle.test.js
```

Expected: 13 tests pass (documenting current behavior)

---

## Step 2: Write Service Tests (RED)

**File:** `tests/services/test-filter-manager.test.js`

Test FilterManager methods:
- `toggleProject(projectId)` - toggle selection
- `selectAllProjects()` / `deselectAllProjects()`
- `getSelectedProjects()` - return IDs
- `toggleTeam(teamId)` - toggle selection
- `selectAllTeams()` / `deselectAllTeams()`
- `getSelectedTeams()` - return IDs
- `toggleStateFilter(stateName)` - add/remove
- `getSelectedStates()` - return array
- `captureFilters()` - return filter state object
- `applyFilters(filters)` - restore filter state

**Run:**
```bash
npm test tests/services/test-filter-manager.test.js
```

Expected: Tests FAIL (FilterManager doesn't exist)

---

## Step 3: Implement FilterManager (GREEN)

**File:** `www/js/services/FilterManager.js`

```javascript
export class FilterManager {
  constructor(eventBus, projects, teams) {
    this.bus = eventBus;
    this.projects = projects;
    this.teams = teams;
    this.selectedStates = new Set();
  }
  
  // Project methods
  toggleProject(projectId) {
    const project = this.projects.find(p => p.id === projectId);
    if (!project) return;
    project.selected = !project.selected;
    this.bus.emit('projects:changed', this.projects);
    this.bus.emit('feature:updated');
  }
  
  selectAllProjects() {
    this.projects.forEach(p => p.selected = true);
    this.bus.emit('projects:changed', this.projects);
    this.bus.emit('feature:updated');
  }
  
  deselectAllProjects() {
    this.projects.forEach(p => p.selected = false);
    this.bus.emit('projects:changed', this.projects);
    this.bus.emit('feature:updated');
  }
  
  getSelectedProjects() {
    return this.projects.filter(p => p.selected).map(p => p.id);
  }
  
  // Team methods (same pattern)
  toggleTeam(teamId) { /* similar */ }
  selectAllTeams() { /* similar */ }
  deselectAllTeams() { /* similar */ }
  getSelectedTeams() { /* similar */ }
  
  // State filter methods
  toggleStateFilter(stateName) {
    if (this.selectedStates.has(stateName)) {
      this.selectedStates.delete(stateName);
    } else {
      this.selectedStates.add(stateName);
    }
    this.bus.emit('filters:changed', {
      selectedStateFilter: Array.from(this.selectedStates)
    });
    this.bus.emit('feature:updated');
  }
  
  getSelectedStates() {
    return Array.from(this.selectedStates);
  }
  
  // Capture/Apply
  captureFilters() {
    return {
      projects: this.getSelectedProjects(),
      teams: this.getSelectedTeams()
    };
  }
  
  applyFilters(filters) {
    if (filters.projects) {
      this.projects.forEach(p => {
        p.selected = filters.projects.includes(p.id);
      });
      this.bus.emit('projects:changed', this.projects);
    }
    
    if (filters.teams) {
      this.teams.forEach(t => {
        t.selected = filters.teams.includes(t.id);
      });
      this.bus.emit('teams:changed', this.teams);
    }
    
    this.bus.emit('feature:updated');
  }
}
```

**Run:**
```bash
npm test tests/services/test-filter-manager.test.js
```

Expected: 25 tests pass

---

## Step 4: Add Delegation to state.js

**File:** `www/js/state.js` (MODIFY)

Add to constructor:
```javascript
import { FilterManager } from './services/FilterManager.js';

constructor() {
  // ... existing code ...
  this._filterManager = null; // Lazy init
}

_ensureFilterManager() {
  if (!this._filterManager && this.projects && this.teams) {
    this._filterManager = new FilterManager(bus, this.projects, this.teams);
    if (this.selectedStateFilter) {
      this._filterManager.selectedStates = new Set(this.selectedStateFilter);
    }
  }
}
```

Add delegation for each method:
```javascript
toggleProjectSelection(projectId) {
  if (featureFlags.USE_FILTER_SERVICE) {
    this._ensureFilterManager();
    return this._filterManager.toggleProject(projectId);
  }
  
  // LEGACY CODE (keep as-is)
  const p = this.projects.find(x => x.id === projectId);
  if (!p) return;
  p.selected = !p.selected;
  bus.emit('projects:changed', this.projects);
  bus.emit('feature:updated');
}
```

Repeat for all filter methods.

---

## Step 5: Integration Tests

**File:** `tests/integration/test-filter-integration.test.js`

Test both paths produce same results:
```javascript
it('should produce same results with flag ON and OFF', () => {
  config.USE_FILTER_SERVICE = false;
  state.toggleProjectSelection('p1');
  const legacyResult = state.projects[0].selected;
  
  state.projects[0].selected = true; // Reset
  
  config.USE_FILTER_SERVICE = true;
  state.toggleProjectSelection('p1');
  const serviceResult = state.projects[0].selected;
  
  expect(legacyResult).to.equal(serviceResult);
});
```

---

## Step 6: Manual Testing

### Test with Flag OFF
```javascript
// www/js/config.js
USE_FILTER_SERVICE: false
```

Open app:
- Toggle project checkboxes
- Click "Select All Projects"
- Click "Deselect All Projects"
- Toggle team filters
- Toggle state filters

### Test with Flag ON
```javascript
// www/js/config.js
USE_FILTER_SERVICE: true
```

Repeat same tests - should work identically.

---

## Acceptance Criteria

- [ ] 13 oracle tests pass
- [ ] 25 service tests pass
- [ ] 5 integration tests pass
- [ ] 92 total tests passing
- [ ] Flag OFF: all filters work
- [ ] Flag ON: all filters work
- [ ] No console errors
- [ ] Behavior identical in both modes

---

## Verification Commands

```bash
# Run all tests
npm test

# Run specific test suites
npm test tests/services/test-filter-oracle.test.js
npm test tests/services/test-filter-manager.test.js
npm test tests/integration/test-filter-integration.test.js

# Start server for manual testing
uvicorn planner:app --reload
```

---

## Common Issues

**Issue:** _filterManager is null  
**Fix:** Call `_ensureFilterManager()` before using `_filterManager`

**Issue:** Events not firing  
**Fix:** Check EventBus is passed to FilterManager constructor

**Issue:** State filter not syncing  
**Fix:** Copy `selectedStateFilter` Set to `_filterManager.selectedStates` in `_ensureFilterManager()`

---

## Next Phase

After Phase 4 complete → Phase 5: CapacityCalculator + BaselineStore

See: `.github/copilot-instructions/PHASE_5_INSTRUCTIONS.md`
