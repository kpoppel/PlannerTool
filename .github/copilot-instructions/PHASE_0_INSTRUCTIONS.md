# Phase 0: Test Infrastructure Setup - Copilot Instructions

**Duration:** 1 day  
**Status:** Not Started  
**Prerequisites:** None

---

## Objective

Set up automated testing infrastructure without changing any application code.

---

## Deliverables

1. ✅ Test runner configured (Web Test Runner + Playwright)
2. ✅ Test helpers created (fixtures, utils, oracle)
3. ✅ 10 baseline tests documenting current behavior
4. ✅ `npm test` command working
5. ✅ Application unchanged (zero modifications to www/js/*.js)

---

## Files to Create

### 1. web-test-runner.config.mjs
```javascript
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files: 'tests/**/*.test.js',
  nodeResolve: true,
  browsers: [playwrightLauncher({ product: 'chromium' })],
  coverage: true,
  coverageConfig: {
    include: ['www/js/**/*.js'],
    exclude: ['www/js/**/*.test.js', 'www/js/providerMock.js'],
    threshold: { statements: 80, branches: 75, functions: 80, lines: 80 }
  },
  testFramework: { config: { timeout: 5000 } }
};
```

### 2. tests/helpers/fixtures.js
Mock data generators:
- `createMockProject(overrides)`
- `createMockTeam(overrides)`
- `createMockFeature(overrides)`
- `createMockScenario(overrides)`
- `createMockState()`

### 3. tests/helpers/testUtils.js
Test utilities:
- `waitFor(condition, timeout)`
- `waitForEvent(eventBus, eventName, timeout)`
- `createMockElement(tag, props)`
- `spyOn(obj, method)`

### 4. tests/helpers/legacyOracle.js
Capture existing behavior:
- `captureScenarioCreation(name)`
- `captureProjectToggle(projectId)`
- `captureCapacityCalculation()`
- `captureEventEmission(eventName)`

### 5. tests/baseline/test-event-bus-behavior.test.js
Document EventBus API:
- Emit and receive string events
- Multiple listeners for same event
- Unsubscribe function from on()
- Error isolation in handlers

### 6. tests/baseline/test-state-behavior.test.js
Document State class methods:
- Scenario creation with unique IDs
- Scenario activation
- Scenario deletion (protect baseline)
- Filter toggles
- Select/deselect all

### 7. tests/baseline/test-data-service-behavior.test.js
Document DataService API:
- Provider routing (mock, local, rest)
- Config methods
- Scenario methods

---

## Package.json Updates

Add to scripts:
```json
{
  "scripts": {
    "test": "web-test-runner",
    "test:watch": "web-test-runner --watch",
    "test:coverage": "web-test-runner --coverage"
  }
}
```

---

## Installation Commands

```bash
source .venv/bin/activate
npm install --save-dev \
  @web/test-runner \
  @web/test-runner-playwright \
  @open-wc/testing \
  chai \
  sinon
```

---

## Acceptance Criteria

- [ ] `npm test` runs and passes 10 baseline tests
- [ ] Tests run in < 5 seconds
- [ ] Coverage report generated
- [ ] No modifications to www/js/*.js files
- [ ] Application runs identically: `uvicorn planner:app --reload`

---

## Verification Steps

1. Run tests: `npm test`
2. Check coverage: `npm test -- --coverage`
3. Start app: `uvicorn planner:app --reload`
4. Open http://localhost:8000
5. Manual checklist:
   - Page loads without errors
   - Can toggle project filters
   - Can create scenarios
   - All existing features work

---

## Common Issues

**Issue:** Tests not finding modules  
**Fix:** Add `nodeResolve: true` to config

**Issue:** Browser not launching  
**Fix:** `npx playwright install chromium`

**Issue:** Import errors  
**Fix:** Use full relative paths with .js extension

---

## Next Phase

After Phase 0 complete → Phase 1: Enhanced EventBus

---

## Reference Files

- AGENT_PHASE_0_GUIDE.md (detailed guide)
- AGENT_ARCHITECTURE_2.md (Phase 0 section)
- AGENT_QUICK_REFERENCE.md (TDD workflow)
