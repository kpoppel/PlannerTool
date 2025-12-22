# Phase 5.1: FeatureService Extraction - Copilot Instructions

Pattern: Oracle + Service + Delegation
Duration: 2 days

Quick summary
- Goal: Move all `features` related logic out of `state.js` into `www/js/services/FeatureService.js` and add a runtime flag `USE_FEATURE_SERVICE` to safely switch between legacy and service implementations.
- Deliverables: `FeatureService.js`, oracle tests, service unit tests, `state.js` delegation, updated `config.js` flag.

Commands you will use
```bash
# Run tests (watch recommended while developing)
npm run test:watch

# Run all tests once
npm test
```

Step 0 — Prep
- Ensure tests pass baseline: `npm test` (fix obvious unrelated breakages first).
- Create a short backup of `www/js/state.js` (copy file with timestamp).

Step 1 — Add feature flag (small change)
- File: `www/js/config.js`
- Add entry: `USE_FEATURE_SERVICE: false` (default OFF)

Step 2 — Write Oracle Tests (RED)
- Location: `tests/oracle/test-feature-oracle.test.js`
- Capture current behavior for these flows:
  - `createFeature(feature)` — id generation, inserted order
  - `updateFeature(id, patch)` — fields updated & event emitted
  - `deleteFeature(id)` — removal and cascade side-effects
  - `getFeatures()` + filtering behavior
- Tests should run with legacy behavior (flag OFF) and record expected outputs.

Step 3 — Create `FeatureService` skeleton (RED)
- File: `www/js/services/FeatureService.js`
- Export a `FeatureService` class and `featureService` singleton
- Public API: `createFeature`, `updateFeature`, `deleteFeature`, `getFeatures`, `findFeatureById`, `applyFilter`.

Minimal template:
```javascript
import { bus } from '../eventBus.js';

export class FeatureService {
  constructor() { this.features = []; }
  createFeature(feature) { /* throw not implemented in RED phase */ }
  updateFeature(id, patch) { }
  deleteFeature(id) { }
  getFeatures() { return this.features; }
}

export const featureService = new FeatureService();
```

Step 4 — Service Unit Tests (RED)
- Location: `tests/services/test-feature-service.test.js`
- Write tests for the public API (initially expect them to fail)

Step 5 — Implement FeatureService (GREEN)
- Implement methods to satisfy unit tests and maintain same behavior as legacy `state.js` for features.
- Emit the same events via `bus.emit(...)` where `state.js` used to.

Step 6 — Delegate `state.js` (small change)
- Update `www/js/state.js` so that when `featureFlags.USE_FEATURE_SERVICE === true` it calls `featureService` methods instead of the legacy internal implementations.
- Keep legacy code paths for `false` to allow rollback.

Example delegation snippet:
```javascript
import { featureService } from './services/FeatureService.js';
import { featureFlags } from './config.js';

function createFeature(feature) {
  if (featureFlags.USE_FEATURE_SERVICE) {
    return featureService.createFeature(feature);
  }
  // legacy implementation below
}
```

Step 7 — Integration & Oracle verification
- Run oracle tests and unit tests. Flip the flag `USE_FEATURE_SERVICE` ON and run integration tests to verify identical behavior.

Acceptance criteria
- [ ] `FeatureService.js` implemented and exported
- [ ] Oracle tests capture legacy behavior (RED → GREEN)
- [ ] Service tests pass
- [ ] `state.js` delegates when `USE_FEATURE_SERVICE === true`
- [ ] Full test suite passes with the flag ON and OFF
- [ ] No console errors in the app

If you'd like, I can scaffold the service and tests now and run the test suite; say "Scaffold and run".