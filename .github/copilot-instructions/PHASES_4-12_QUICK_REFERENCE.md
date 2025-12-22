# Phases 4-12: Quick Reference - Copilot Instructions

**Status:** Phases 0-3 have detailed guides. Phases 4-12 follow similar patterns.

---

## Phase 4: FilterManager Extraction

**Duration:** 3 days  
**Pattern:** Oracle + Service + Delegation (same as Phase 3)

**Deliverables:**
- Oracle tests for filter methods
- FilterManager.js service
- state.js delegation with USE_FILTER_SERVICE flag
- 25 new tests

**Key Methods to Extract:**
- `applyFilters()`
- `toggleFilter()`
- `clearFilters()`
- `getActiveFilters()`
- `setFilterOptions()`

**Reference:** AGENT_ARCHITECTURE_2.md Phase 4 section

---

## Phase 5: CapacityCalculator + BaselineStore

**Duration:** 3 days  
**Pattern:** Oracle + Service + Delegation

**Deliverables:**
- CapacityCalculator.js (capacity logic)
- BaselineStore.js (baseline data storage)
- state.js delegation with USE_CAPACITY_SERVICE, USE_BASELINE_SERVICE flags
- 30 new tests

**Key Methods:**
- CapacityCalculator: `calculateTotalCapacity()`, `getResourceLoad()`
- BaselineStore: `loadBaseline()`, `saveBaseline()`, `clearBaseline()`

**Reference:** AGENT_ARCHITECTURE_2.md Phase 5 section

---

## Phase 6: State.js Cleanup

**Duration:** 2 days  
**Pattern:** Remove delegated code, keep only coordination

**Goal:** state.js becomes thin coordinator (< 200 LOC)

**Steps:**
1. Set all service flags to TRUE
2. Remove legacy code blocks wrapped in `if (!featureFlag)`
3. Keep only service method calls
4. Run full test suite
5. Manual regression testing

**Acceptance:** state.js is < 200 LOC, all 120+ tests pass

**Reference:** AGENT_ARCHITECTURE_2.md Phase 6 section

---

## Phase 7: Plugin Manager + Config

**Duration:** 3 days  
**Pattern:** New infrastructure (no oracle needed)

**Deliverables:**
- PluginManager.js (load/unload plugins)
- modules.config.json (which modules to load)
- Plugin interface definition
- 15 new tests

**Example modules.config.json:**
```json
{
  "core": {
    "eventBus": { "enabled": true },
    "dataService": { "enabled": true }
  },
  "ui": {
    "mainGraph": { "enabled": true },
    "timeline": { "enabled": true },
    "sidebar": { "enabled": false }
  }
}
```

**Key Features:**
- Load plugins dynamically based on config
- Graceful degradation if plugin missing
- Plugin lifecycle hooks (init, destroy)

**Reference:** AGENT_ARCHITECTURE_2.md Phase 7 section

---

## Phase 8: Convert 2 Components to Lit

**Duration:** 3 days  
**Pattern:** Parallel implementation with feature flag

**Target Components:**
1. FeatureCard.js → FeatureCard.lit.js
2. Modal.js → Modal.lit.js

**Steps:**
1. Write component tests (Lit testing)
2. Create Lit version alongside vanilla
3. Add USE_LIT_COMPONENTS flag
4. Update app.js to conditionally load
5. Visual regression testing

**Acceptance:** Both vanilla and Lit versions work, can toggle via flag

**Reference:** AGENT_ARCHITECTURE_2.md Phase 8 section

---

## Phase 9: Convert Remaining Components

**Duration:** 5 days  
**Pattern:** Same as Phase 8, more components

**Target Components:**
- MainGraph.js → MainGraph.lit.js
- Timeline.js → Timeline.lit.js
- Sidebar.js → Sidebar.lit.js
- DetailsPanel.js → DetailsPanel.lit.js
- DragManager.js → DragManager.lit.js
- DependencyRenderer.js → DependencyRenderer.lit.js

**Strategy:** Convert 2 per day, full test + manual check each

**Reference:** AGENT_ARCHITECTURE_2.md Phase 9 section

---

## Phase 10: Command Pattern (Undo/Redo)

**Duration:** 3 days  
**Pattern:** New infrastructure + integration

**Deliverables:**
- Command.js (base class)
- CommandHistory.js (undo/redo stack)
- Concrete commands: CreateFeatureCommand, DeleteFeatureCommand, etc.
- UI controls (undo/redo buttons)
- 20 new tests

**Key Concepts:**
- Each state mutation = command object
- Commands have execute() and undo() methods
- CommandHistory manages stack
- Keyboard shortcuts: Ctrl+Z, Ctrl+Shift+Z

**Reference:** AGENT_ARCHITECTURE_2.md Phase 10 section

---

## Phase 11: Cleanup Legacy Code

**Duration:** 2 days  
**Pattern:** Remove old code paths

**Goal:** Delete all feature-flagged legacy code

**Steps:**
1. Verify all feature flags set to TRUE
2. Delete old vanilla JS files (replaced by Lit)
3. Delete legacy code blocks in state.js
4. Remove feature flag checks
5. Update documentation
6. Run full test suite (all 350+ tests)

**Acceptance:** 
- No feature flags remain
- All tests pass
- Application size reduced
- Only modern code paths exist

**Reference:** AGENT_ARCHITECTURE_2.md Phase 11 section

---

## Phase 12: Documentation + Polish

**Duration:** 2 days  
**Pattern:** Documentation and final touches

**Deliverables:**
- Updated README.md
- Architecture diagram
- API documentation
- Developer guide
- Plugin development guide
- Performance audit
- Accessibility audit

**Tasks:**
- Generate JSDoc for all services
- Create visual architecture diagram (draw.io or mermaid)
- Update ARCHITECTURE.md with final structure
- Add inline code comments
- Run Lighthouse audit
- Run axe accessibility audit
- Create CHANGELOG.md

**Acceptance:**
- All code documented
- Documentation matches implementation
- Performance score > 90
- Accessibility score > 90

**Reference:** AGENT_ARCHITECTURE_2.md Phase 12 section

---

## General Patterns Across All Phases

### TDD Workflow
1. **RED:** Write failing tests
2. **GREEN:** Minimal implementation to pass
3. **REFACTOR:** Clean up while tests stay green

### Feature Flag Pattern
```javascript
if (featureFlags.USE_NEW_FEATURE) {
  // New implementation
} else {
  // Legacy implementation
}
```

### Service Extraction Pattern
1. Write oracle tests (capture current behavior)
2. Write service tests (target behavior)
3. Implement service
4. Add delegation to state.js
5. Integration tests with flag ON and OFF

### Testing Checklist (Every Phase)
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing (UI still works)
- [ ] Feature flag ON works
- [ ] Feature flag OFF works
- [ ] No console errors
- [ ] Events fire correctly

### Verification Commands
```bash
# Run all tests
npm test

# Run specific test file
npm test tests/services/test-scenario-manager.test.js

# Run with coverage
npm run test:coverage

# Start dev server
source .venv/bin/activate
uvicorn planner:app --reload
```

---

## Critical Rules for All Phases

1. **NEVER delete working code until replacement is proven**
2. **ALWAYS write tests before implementation**
3. **ALWAYS test with feature flags ON and OFF**
4. **ALWAYS manual test after each change**
5. **NEVER commit failing tests**
6. **ALWAYS keep application in working state**

---

## Phase Dependencies

```
Phase 0 (Test Infrastructure)
  ↓
Phase 1 (Enhanced EventBus)
  ↓
Phase 2 (DI Container)
  ↓
Phase 3 (ScenarioManager) ← CRITICAL
  ↓
Phase 4 (FilterManager)
  ↓
Phase 5 (CapacityCalculator + BaselineStore)
  ↓
Phase 6 (State Cleanup)
  ↓
Phase 7 (Plugin Manager)
  ↓
Phase 8 (Convert 2 Lit Components)
  ↓
Phase 9 (Convert Remaining Components)
  ↓
Phase 10 (Command Pattern)
  ↓
Phase 11 (Legacy Cleanup)
  ↓
Phase 12 (Documentation)
```

**Total Duration:** 39 days (8 weeks)

---

## Getting Help

- **Detailed Phase Guides:** AGENT_PHASE_X_GUIDE.md files
- **Quick Reference:** AGENT_QUICK_REFERENCE.md
- **Architecture Overview:** AGENT_ARCHITECTURE_2.md
- **Delegation Strategy:** .github/AGENT_DELEGATION_GUIDE.md

---

## Test Coverage Goals

| Phase | New Tests | Cumulative |
|-------|-----------|------------|
| 0     | 10        | 10         |
| 1     | 15        | 25         |
| 2     | 12        | 37         |
| 3     | 30        | 67         |
| 4     | 25        | 92         |
| 5     | 30        | 122        |
| 6     | 10        | 132        |
| 7     | 15        | 147        |
| 8     | 40        | 187        |
| 9     | 120       | 307        |
| 10    | 20        | 327        |
| 11    | 5         | 332        |
| 12    | 10        | 342        |

**Target:** 350+ tests, 85%+ coverage

---

## Success Metrics

### Code Quality
- State.js reduced from 823 LOC to < 200 LOC
- Average module size < 150 LOC
- Cyclomatic complexity < 10 per function

### Testing
- 350+ tests passing
- 85%+ code coverage
- All critical paths tested

### Performance
- Lighthouse score > 90
- Bundle size < 500KB
- Time to interactive < 2s

### Maintainability
- All modules pluggable via config
- Clean Architecture layers enforced
- Dependency injection throughout
- Undo/redo capability
- Comprehensive documentation
