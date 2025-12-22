# Phase 5: CapacityCalculator + BaselineStore - Copilot Instructions

**Pattern:** Oracle + Service + Delegation  
**Files:** 2 services, 50+ tests  
**Duration:** 4 days

---

## Quick Start

```bash
# Run tests in watch mode
npm run test:watch

# Target specific test file
npm run test:watch -- --grep "CapacityCalculator"
```

---

## Step 1: Write Oracle Tests (RED - Day 1)

### File: `tests/oracle/test-capacity-oracle.test.js`

```javascript
import { describe, it, beforeEach } from '@web/test-runner';
import { expect } from '@open-wc/testing';
import { captureCapacityCalculation } from '../helpers/legacyOracle.js';
import { state } from '../../www/js/state.js';
import { createMockFeature, createMockTeam } from '../helpers/fixtures.js';

describe('Capacity Calculation Oracle', () => {
  beforeEach(() => {
    state.features = [];
    state.teams = [];
  });
  
  it('should calculate total capacity for single team, single feature', () => {
    const team = createMockTeam('Team A', 10);
    const feature = createMockFeature('f1', '2024-01-01', '2024-01-10', [
      { team: 'Team A', load: 5 }
    ]);
    
    const result = captureCapacityCalculation([feature], [team]);
    
    // Document current behavior
    expect(result.totalCapacity).to.be.a('number');
    expect(result.usedCapacity).to.be.a('number');
    expect(result.remainingCapacity).to.be.a('number');
  });
  
  // Add 15 more oracle tests covering:
  // - Multiple teams
  // - Overlapping features
  // - Different date ranges
  // - Project-level aggregation
  // - Edge cases (0 capacity, negative dates)
});
```

### File: `tests/oracle/test-baseline-oracle.test.js`

```javascript
describe('Baseline Storage Oracle', () => {
  it('should store baseline snapshot', () => {
    const snapshot = state.captureBaseline();
    
    expect(snapshot).to.have.property('features');
    expect(snapshot).to.have.property('capacity');
    expect(snapshot).to.have.property('timestamp');
  });
  
  it('should restore baseline snapshot', () => {
    const before = state.captureBaseline();
    
    // Modify state
    state.features.push(createMockFeature('new'));
    
    // Restore
    state.restoreBaseline(before);
    
    expect(state.features.length).to.equal(before.features.length);
  });
  
  // Add 8 more oracle tests
});
```

**Run:** `npm test` → Should have ~20 failing tests (capturing behavior)

---

## Step 2: Make Oracle Tests Pass (GREEN - Day 1)

Update `tests/helpers/legacyOracle.js`:

```javascript
export function captureCapacityCalculation(features, teams) {
  // Call existing state.js methods
  const dateRange = state._generateDateRange(features);
  const teamCapacity = state._calculateTeamCapacity(teams, dateRange);
  const usedCapacity = state._calculateUsedCapacity(features);
  
  return {
    totalCapacity: teamCapacity,
    usedCapacity: usedCapacity,
    remainingCapacity: teamCapacity - usedCapacity,
    dateRange: dateRange
  };
}

export function captureBaseline() {
  return state.captureBaseline();
}

export function restoreBaseline(snapshot) {
  state.restoreBaseline(snapshot);
}
```

**Run:** `npm test` → 167 tests passing (147 existing + 20 new oracle)

---

## Step 3: Write Service Tests (RED - Day 2)

### File: `tests/services/test-capacity-calculator.test.js`

```javascript
import { CapacityCalculator } from '../../www/js/services/CapacityCalculator.js';

describe('CapacityCalculator', () => {
  let calculator;
  
  beforeEach(() => {
    calculator = new CapacityCalculator();
  });
  
  it('should calculate capacity for single team', () => {
    const features = [createMockFeature('f1', '2024-01-01', '2024-01-10', [
      { team: 'Team A', load: 5 }
    ])];
    const teams = [createMockTeam('Team A', 10)];
    
    const result = calculator.calculate(features, teams);
    
    expect(result.totalCapacity).to.equal(100); // 10 days * 10 capacity
    expect(result.usedCapacity).to.equal(50); // 10 days * 5 load
    expect(result.remainingCapacity).to.equal(50);
  });
  
  it('should handle overlapping features', () => {
    const features = [
      createMockFeature('f1', '2024-01-01', '2024-01-10', [{ team: 'Team A', load: 5 }]),
      createMockFeature('f2', '2024-01-05', '2024-01-15', [{ team: 'Team A', load: 3 }])
    ];
    const teams = [createMockTeam('Team A', 10)];
    
    const result = calculator.calculate(features, teams);
    
    // Should account for overlap
    expect(result.usedCapacity).to.be.greaterThan(50);
  });
  
  // Add 20 more tests covering:
  // - Multiple teams
  // - Project aggregation
  // - Date range generation
  // - Edge cases
});
```

### File: `tests/services/test-baseline-store.test.js`

```javascript
import { BaselineStore } from '../../www/js/services/BaselineStore.js';

describe('BaselineStore', () => {
  let store;
  
  beforeEach(() => {
    store = new BaselineStore();
  });
  
  it('should save snapshot', () => {
    const data = { features: [], timestamp: Date.now() };
    
    store.save('snapshot1', data);
    
    expect(store.has('snapshot1')).to.be.true;
  });
  
  it('should load snapshot', () => {
    const data = { features: [createMockFeature('f1')] };
    store.save('snapshot1', data);
    
    const loaded = store.load('snapshot1');
    
    expect(loaded.features.length).to.equal(1);
  });
  
  // Add 8 more tests
});
```

**Run:** `npm test` → ~30 failing tests (service tests)

---

## Step 4: Implement Services (GREEN - Day 2-3)

### File: `www/js/services/CapacityCalculator.js`

```javascript
import { bus } from '../eventBus.js';

export class CapacityCalculator {
  calculate(features, teams) {
    const dateRange = this._generateDateRange(features);
    const totalCapacity = this._calculateTotalCapacity(teams, dateRange);
    const usedCapacity = this._calculateUsedCapacity(features, dateRange);
    
    return {
      totalCapacity,
      usedCapacity,
      remainingCapacity: totalCapacity - usedCapacity,
      dateRange,
      byTeam: this._calculateByTeam(features, teams, dateRange),
      byProject: this._calculateByProject(features, teams, dateRange)
    };
  }
  
  _generateDateRange(features) {
    if (features.length === 0) return [];
    
    const start = new Date(Math.min(...features.map(f => new Date(f.start))));
    const end = new Date(Math.max(...features.map(f => new Date(f.end))));
    
    const range = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      range.push(new Date(d));
    }
    return range;
  }
  
  _calculateTotalCapacity(teams, dateRange) {
    return dateRange.reduce((total, date) => {
      const dayCapacity = teams.reduce((sum, team) => sum + (team.capacity || 0), 0);
      return total + dayCapacity;
    }, 0);
  }
  
  _calculateUsedCapacity(features, dateRange) {
    return dateRange.reduce((total, date) => {
      const dayUsed = features.reduce((sum, feature) => {
        if (this._isDateInFeature(date, feature)) {
          const featureLoad = feature.capacity.reduce((load, cap) => load + cap.load, 0);
          return sum + featureLoad;
        }
        return sum;
      }, 0);
      return total + dayUsed;
    }, 0);
  }
  
  _isDateInFeature(date, feature) {
    const d = date.getTime();
    const start = new Date(feature.start).getTime();
    const end = new Date(feature.end).getTime();
    return d >= start && d <= end;
  }
  
  _calculateByTeam(features, teams, dateRange) {
    // Group capacity by team
    return teams.map(team => ({
      team: team.name,
      total: this._calculateTeamCapacity(team, dateRange),
      used: this._calculateTeamUsed(team, features, dateRange)
    }));
  }
  
  _calculateByProject(features, teams, dateRange) {
    // Group capacity by project
    const projects = [...new Set(features.map(f => f.project))];
    return projects.map(project => {
      const projectFeatures = features.filter(f => f.project === project);
      return {
        project,
        used: this._calculateUsedCapacity(projectFeatures, dateRange)
      };
    });
  }
  
  // Additional helper methods...
}
```

### File: `www/js/services/BaselineStore.js`

```javascript
export class BaselineStore {
  constructor() {
    this.snapshots = new Map();
  }
  
  save(name, data) {
    this.snapshots.set(name, {
      ...data,
      timestamp: Date.now()
    });
  }
  
  load(name) {
    return this.snapshots.get(name);
  }
  
  has(name) {
    return this.snapshots.has(name);
  }
  
  delete(name) {
    return this.snapshots.delete(name);
  }
  
  list() {
    return Array.from(this.snapshots.keys());
  }
  
  clear() {
    this.snapshots.clear();
  }
}
```

**Run:** `npm test` → 197 tests passing (167 + 30 new)

---

## Step 5: Integrate with State (Day 3)

### File: `www/js/state.js` (MODIFY)

```javascript
import { featureFlags } from './config.js';
import { CapacityCalculator } from './services/CapacityCalculator.js';
import { BaselineStore } from './services/BaselineStore.js';

const capacityCalculator = new CapacityCalculator();
const baselineStore = new BaselineStore();

const state = {
  // ... existing properties ...
  
  calculateCapacity() {
    if (featureFlags.USE_CAPACITY_SERVICE) {
      return capacityCalculator.calculate(this.features, this.teams);
    } else {
      // Legacy implementation
      return this._legacyCalculateCapacity();
    }
  },
  
  captureBaseline(name = 'default') {
    if (featureFlags.USE_BASELINE_SERVICE) {
      const snapshot = {
        features: JSON.parse(JSON.stringify(this.features)),
        teams: JSON.parse(JSON.stringify(this.teams)),
        projects: JSON.parse(JSON.stringify(this.projects))
      };
      baselineStore.save(name, snapshot);
      return snapshot;
    } else {
      return this._legacyCaptureBaseline();
    }
  },
  
  restoreBaseline(name = 'default') {
    if (featureFlags.USE_BASELINE_SERVICE) {
      const snapshot = baselineStore.load(name);
      if (snapshot) {
        this.features = snapshot.features;
        this.teams = snapshot.teams;
        this.projects = snapshot.projects;
        bus.emit('baseline:restored', snapshot);
      }
    } else {
      this._legacyRestoreBaseline(name);
    }
  },
  
  // Keep legacy methods for now...
  _legacyCalculateCapacity() { /* existing code */ },
  _legacyCaptureBaseline() { /* existing code */ },
  _legacyRestoreBaseline() { /* existing code */ }
};
```

---

## Step 6: Write Integration Tests (Day 4)

### File: `tests/integration/test-capacity-integration.test.js`

```javascript
describe('Capacity Integration', () => {
  it('should calculate capacity through state', () => {
    featureFlags.enable('USE_CAPACITY_SERVICE');
    
    state.features = [createMockFeature('f1', '2024-01-01', '2024-01-10')];
    state.teams = [createMockTeam('Team A', 10)];
    
    const result = state.calculateCapacity();
    
    expect(result.totalCapacity).to.be.greaterThan(0);
  });
  
  // Add 5 more integration tests
});
```

**Run:** `npm test` → 203 tests passing

---

## Step 7: Manual Testing

### With Flag OFF (Legacy)
```javascript
featureFlags.USE_CAPACITY_SERVICE = false;
featureFlags.USE_BASELINE_SERVICE = false;
```

1. Load scenario
2. Check capacity calculations in UI
3. Create baseline snapshot
4. Restore snapshot
5. Verify all works as before

### With Flag ON (New Services)
```javascript
featureFlags.USE_CAPACITY_SERVICE = true;
featureFlags.USE_BASELINE_SERVICE = true;
```

1. Repeat all tests above
2. Results should be identical
3. Check console for service logs
4. Verify no errors

---

## Acceptance Criteria

- [ ] 20 oracle tests passing (capacity + baseline)
- [ ] 30 service tests passing (22 capacity + 8 baseline)
- [ ] 6 integration tests passing
- [ ] 203 total tests passing
- [ ] CapacityCalculator.js created
- [ ] BaselineStore.js created
- [ ] state.js delegates with flags
- [ ] Legacy code preserved
- [ ] Both modes work identically

---

## Next: Phase 6 - State Cleanup
