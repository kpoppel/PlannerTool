# Phase 3: ScenarioManager Extraction - Copilot Instructions

**Duration:** 3 days  
**Status:** Not Started  
**Prerequisites:** Phase 2 complete (DI Container)

---

## ⚠️ CRITICAL PHASE

This is the **most important phase**. State.js is 823 LOC of tangled logic. We use the **Oracle Test Pattern** to capture existing behavior before extraction.

---

## Objective

Extract scenario management logic from state.js into ScenarioManager service. Use delegation pattern with feature flag to run legacy and new code side-by-side.

---

## Deliverables

1. ✅ Oracle tests (capture current state.js behavior)
2. ✅ ScenarioManager.js (new service)
3. ✅ Updated state.js with delegation
4. ✅ 30 new tests passing (67 total)
5. ✅ Feature flag: USE_SCENARIO_SERVICE

---

## TDD Workflow

### Step 1: Oracle Tests (CAPTURE)

**File:** `tests/services/test-scenario-oracle.test.js`

Purpose: Record exact behavior of current state.js for comparison.

```javascript
import { expect } from '@open-wc/testing';
import { state } from '../../www/js/state.js';

/**
 * Oracle Tests: Capture existing state.js scenario behavior
 * These tests document CURRENT behavior (even if buggy)
 * DO NOT FIX BUGS - just record what happens now
 */
describe('Oracle: State Scenario Behavior', () => {
  beforeEach(() => {
    // Reset state to known configuration
    state.currentScenario = null;
    state.scenarios.clear();
  });
  
  it('activateScenario: sets currentScenario', () => {
    const scenario = { id: 's1', name: 'Test' };
    state.scenarios.set('s1', scenario);
    
    state.activateScenario('s1');
    
    expect(state.currentScenario).to.equal(scenario);
  });
  
  it('activateScenario: emits scenario:activated', (done) => {
    const scenario = { id: 's1', name: 'Test' };
    state.scenarios.set('s1', scenario);
    
    bus.on('scenario:activated', (data) => {
      expect(data.scenarioId).to.equal('s1');
      done();
    });
    
    state.activateScenario('s1');
  });
  
  it('activateScenario: returns undefined if not found', () => {
    const result = state.activateScenario('nonexistent');
    expect(result).to.be.undefined;
  });
  
  it('saveScenario: updates existing scenario', () => {
    const scenario = { id: 's1', name: 'Old', features: [] };
    state.scenarios.set('s1', scenario);
    
    state.saveScenario({ id: 's1', name: 'New', features: [1, 2] });
    
    const saved = state.scenarios.get('s1');
    expect(saved.name).to.equal('New');
    expect(saved.features).to.deep.equal([1, 2]);
  });
  
  it('saveScenario: emits scenario:saved', (done) => {
    state.scenarios.set('s1', { id: 's1', name: 'Test' });
    
    bus.on('scenario:saved', (data) => {
      expect(data.scenario.name).to.equal('Updated');
      done();
    });
    
    state.saveScenario({ id: 's1', name: 'Updated' });
  });
  
  it('createScenario: generates new ID', () => {
    const scenario = state.createScenario('New Scenario');
    
    expect(scenario.id).to.be.a('string');
    expect(scenario.name).to.equal('New Scenario');
    expect(state.scenarios.has(scenario.id)).to.be.true;
  });
  
  it('createScenario: emits scenario:created', (done) => {
    bus.on('scenario:created', (data) => {
      expect(data.scenario.name).to.equal('Test');
      done();
    });
    
    state.createScenario('Test');
  });
  
  it('deleteScenario: removes from map', () => {
    state.scenarios.set('s1', { id: 's1', name: 'Test' });
    
    state.deleteScenario('s1');
    
    expect(state.scenarios.has('s1')).to.be.false;
  });
  
  it('deleteScenario: emits scenario:deleted', (done) => {
    state.scenarios.set('s1', { id: 's1', name: 'Test' });
    
    bus.on('scenario:deleted', (data) => {
      expect(data.scenarioId).to.equal('s1');
      done();
    });
    
    state.deleteScenario('s1');
  });
  
  it('getScenario: returns scenario by ID', () => {
    const scenario = { id: 's1', name: 'Test' };
    state.scenarios.set('s1', scenario);
    
    const result = state.getScenario('s1');
    
    expect(result).to.equal(scenario);
  });
  
  it('getAllScenarios: returns array', () => {
    state.scenarios.set('s1', { id: 's1', name: 'Test1' });
    state.scenarios.set('s2', { id: 's2', name: 'Test2' });
    
    const all = state.getAllScenarios();
    
    expect(all).to.be.an('array');
    expect(all.length).to.equal(2);
  });
});
```

**Run Oracle Tests:**
```bash
npm test tests/services/test-scenario-oracle.test.js
```

Expected: All pass (recording current behavior)

### Step 2: ScenarioManager Tests (RED)

**File:** `tests/services/test-scenario-manager.test.js`

```javascript
import { expect } from '@open-wc/testing';
import { ScenarioManager } from '../../www/js/services/ScenarioManager.js';
import { bus } from '../../www/js/eventBus.js';

/**
 * ScenarioManager Service Tests
 * These tests define DESIRED behavior (matches oracle)
 */
describe('ScenarioManager Service', () => {
  let manager;
  
  beforeEach(() => {
    manager = new ScenarioManager(bus);
  });
  
  it('activateScenario: sets current', () => {
    manager.scenarios.set('s1', { id: 's1', name: 'Test' });
    
    manager.activateScenario('s1');
    
    expect(manager.currentScenario.id).to.equal('s1');
  });
  
  it('activateScenario: emits event', (done) => {
    manager.scenarios.set('s1', { id: 's1', name: 'Test' });
    
    bus.on('scenario:activated', (data) => {
      expect(data.scenarioId).to.equal('s1');
      done();
    });
    
    manager.activateScenario('s1');
  });
  
  it('saveScenario: updates existing', () => {
    manager.scenarios.set('s1', { id: 's1', name: 'Old' });
    
    manager.saveScenario({ id: 's1', name: 'New' });
    
    expect(manager.scenarios.get('s1').name).to.equal('New');
  });
  
  it('createScenario: generates ID', () => {
    const scenario = manager.createScenario('Test');
    
    expect(scenario.id).to.be.a('string');
    expect(manager.scenarios.has(scenario.id)).to.be.true;
  });
  
  it('deleteScenario: removes', () => {
    manager.scenarios.set('s1', { id: 's1', name: 'Test' });
    
    manager.deleteScenario('s1');
    
    expect(manager.scenarios.has('s1')).to.be.false;
  });
  
  // ... 25 more tests (see AGENT_PHASE_3_GUIDE.md)
});
```

**Expected:** Tests FAIL (RED) - ScenarioManager doesn't exist

### Step 3: Create ScenarioManager (GREEN)

**File:** `www/js/services/ScenarioManager.js`

```javascript
import { generateId } from '../util.js';

/**
 * ScenarioManager Service
 * Manages scenario lifecycle: create, activate, save, delete
 */
export class ScenarioManager {
  constructor(eventBus) {
    this.bus = eventBus;
    this.scenarios = new Map();
    this.currentScenario = null;
  }
  
  /**
   * Activate a scenario
   * @param {string} scenarioId
   */
  activateScenario(scenarioId) {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) {
      console.warn(`Scenario not found: ${scenarioId}`);
      return;
    }
    
    this.currentScenario = scenario;
    this.bus.emit('scenario:activated', { 
      scenarioId, 
      scenario 
    });
  }
  
  /**
   * Save (update) a scenario
   * @param {Object} scenarioData
   */
  saveScenario(scenarioData) {
    const { id } = scenarioData;
    if (!id || !this.scenarios.has(id)) {
      throw new Error(`Cannot save: scenario ${id} not found`);
    }
    
    const existing = this.scenarios.get(id);
    const updated = { ...existing, ...scenarioData };
    this.scenarios.set(id, updated);
    
    this.bus.emit('scenario:saved', { 
      scenario: updated 
    });
    
    return updated;
  }
  
  /**
   * Create new scenario
   * @param {string} name
   * @returns {Object} New scenario
   */
  createScenario(name) {
    const scenario = {
      id: generateId(),
      name,
      features: [],
      createdAt: new Date().toISOString()
    };
    
    this.scenarios.set(scenario.id, scenario);
    
    this.bus.emit('scenario:created', { 
      scenario 
    });
    
    return scenario;
  }
  
  /**
   * Delete a scenario
   * @param {string} scenarioId
   */
  deleteScenario(scenarioId) {
    if (!this.scenarios.has(scenarioId)) {
      console.warn(`Cannot delete: scenario ${scenarioId} not found`);
      return;
    }
    
    this.scenarios.delete(scenarioId);
    
    if (this.currentScenario?.id === scenarioId) {
      this.currentScenario = null;
    }
    
    this.bus.emit('scenario:deleted', { 
      scenarioId 
    });
  }
  
  /**
   * Get scenario by ID
   * @param {string} scenarioId
   * @returns {Object|undefined}
   */
  getScenario(scenarioId) {
    return this.scenarios.get(scenarioId);
  }
  
  /**
   * Get all scenarios
   * @returns {Array<Object>}
   */
  getAllScenarios() {
    return Array.from(this.scenarios.values());
  }
  
  /**
   * Get current active scenario
   * @returns {Object|null}
   */
  getCurrentScenario() {
    return this.currentScenario;
  }
}
```

**Run Tests:**
```bash
npm test tests/services/test-scenario-manager.test.js
# Expected: 30 tests pass
```

### Step 4: Update state.js with Delegation (REFACTOR)

**File:** `www/js/state.js` (MODIFY existing)

```javascript
import { featureFlags } from './config.js';
import { bus } from './eventBus.js';
import { ScenarioManager } from './services/ScenarioManager.js';

class State {
  constructor() {
    // Initialize scenario manager
    this._scenarioManager = new ScenarioManager(bus);
    
    // ... existing code
  }
  
  // DELEGATION: Route to service if enabled, else use legacy
  activateScenario(scenarioId) {
    if (featureFlags.USE_SCENARIO_SERVICE) {
      return this._scenarioManager.activateScenario(scenarioId);
    }
    
    // LEGACY CODE (keep as-is)
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) return;
    this.currentScenario = scenario;
    bus.emit('scenario:activated', { scenarioId, scenario });
  }
  
  saveScenario(scenarioData) {
    if (featureFlags.USE_SCENARIO_SERVICE) {
      return this._scenarioManager.saveScenario(scenarioData);
    }
    
    // LEGACY CODE
    const { id } = scenarioData;
    const existing = this.scenarios.get(id);
    const updated = { ...existing, ...scenarioData };
    this.scenarios.set(id, updated);
    bus.emit('scenario:saved', { scenario: updated });
    return updated;
  }
  
  createScenario(name) {
    if (featureFlags.USE_SCENARIO_SERVICE) {
      return this._scenarioManager.createScenario(name);
    }
    
    // LEGACY CODE
    const scenario = {
      id: generateId(),
      name,
      features: [],
      createdAt: new Date().toISOString()
    };
    this.scenarios.set(scenario.id, scenario);
    bus.emit('scenario:created', { scenario });
    return scenario;
  }
  
  // ... repeat for deleteScenario, getScenario, getAllScenarios
}

export const state = new State();
```

### Step 5: Integration Tests (GREEN)

**File:** `tests/integration/test-scenario-integration.test.js`

Test with feature flag ON and OFF - both paths must work identically.

---

## Acceptance Criteria

- [ ] Oracle tests capture existing behavior (10 tests pass)
- [ ] ScenarioManager tests pass (30 tests pass)
- [ ] Integration tests pass with flag ON and OFF (67 total)
- [ ] state.js delegates correctly when USE_SCENARIO_SERVICE = true
- [ ] state.js uses legacy code when USE_SCENARIO_SERVICE = false
- [ ] Application works identically in both modes
- [ ] Manual testing: create, activate, save, delete scenarios (both modes)

---

## Manual Testing

**Test 1: Legacy Mode (flag OFF)**
```javascript
// www/js/config.js
export const featureFlags = {
  USE_SCENARIO_SERVICE: false,
  // ...
};
```

Load app → Create scenario → Activate → Save → Delete  
Expected: All work (using legacy state.js code)

**Test 2: Service Mode (flag ON)**
```javascript
// www/js/config.js
export const featureFlags = {
  USE_SCENARIO_SERVICE: true,
  // ...
};
```

Load app → Create scenario → Activate → Save → Delete  
Expected: All work identically (using ScenarioManager)

**Test 3: Console Verification**
```javascript
// Check which path is used
import('./js/config.js').then(m => console.log('Flag:', m.featureFlags.USE_SCENARIO_SERVICE));

// Test scenario operations
state.createScenario('Test Console');
state.activateScenario(state.getAllScenarios()[0].id);
```

---

## Verification Checklist

- [ ] Oracle tests document current behavior
- [ ] ScenarioManager matches oracle behavior exactly
- [ ] Delegation in state.js routes correctly
- [ ] Both code paths produce identical results
- [ ] Events fire in both modes
- [ ] No console errors in either mode
- [ ] UI updates correctly in both modes
- [ ] Can switch between modes with just flag change

---

## Common Issues

**Issue:** Oracle tests fail  
**Fix:** Don't change state.js yet - oracle captures CURRENT behavior

**Issue:** ScenarioManager events not firing  
**Fix:** Check EventBus passed to constructor

**Issue:** Delegation always uses legacy  
**Fix:** Verify config.js imports correctly, check featureFlags object

**Issue:** Tests pass but UI broken  
**Fix:** Check that state.scenarios and state.currentScenario still exist (delegation uses _scenarioManager internally)

---

## Critical Rules

1. **DO NOT** delete legacy code in state.js during this phase
2. **DO NOT** fix bugs in oracle tests - record current behavior
3. **ALWAYS** test both feature flag paths
4. **ENSURE** ScenarioManager behavior matches oracle exactly
5. **VERIFY** manually after each step

---

## Next Phase

After Phase 3 complete → Phase 4: FilterManager Extraction (similar pattern)

---

## Reference Files

- AGENT_PHASE_3_GUIDE.md (full code, all 30 tests)
- AGENT_ARCHITECTURE_2.md (Phase 3 section)
- AGENT_QUICK_REFERENCE.md (delegation pattern)
