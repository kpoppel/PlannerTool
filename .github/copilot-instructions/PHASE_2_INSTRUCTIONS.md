# Phase 2: DI Container - Copilot Instructions

**Duration:** 2 days  
**Status:** Not Started  
**Prerequisites:** Phase 1 complete (Enhanced EventBus)

---

## Objective

Create lightweight DI Container for service instantiation, eliminating manual `new` calls in app.js. Enable constructor injection and testability.

---

## Deliverables

1. ✅ Container.js with register/resolve/singleton methods
2. ✅ ServiceRegistry.js with service factory functions
3. ✅ Update app.js to use container
4. ✅ 12 new tests passing (37 total)
5. ✅ Feature flag: USE_DI_CONTAINER

---

## TDD Workflow

### Step 1: Write Failing Tests (RED)

**File:** `tests/core/test-container.test.js`

Required test cases:
- Register and resolve simple class
- Resolve with constructor dependencies
- Singleton pattern (same instance)
- Transient pattern (new instance)
- Circular dependency detection
- Container.reset() clears all
- Factory function support

**Expected:** Tests FAIL (RED) - Container doesn't exist

### Step 2: Create Container (GREEN Part 1)

**File:** `www/js/core/Container.js`

```javascript
/**
 * Lightweight DI Container
 * Supports constructor injection, singletons, and circular detection
 */
export class Container {
  constructor() {
    this.services = new Map();
    this.singletons = new Map();
    this.resolving = new Set();
  }
  
  /**
   * Register a service with its dependencies
   * @param {string} name - Service name
   * @param {Function} factory - Factory function or class constructor
   * @param {Array<string>} deps - Dependency names
   * @param {boolean} singleton - Cache instance
   */
  register(name, factory, deps = [], singleton = false) {
    this.services.set(name, { factory, deps, singleton });
  }
  
  /**
   * Resolve a service by name
   * @param {string} name - Service name
   * @returns {any} Service instance
   */
  resolve(name) {
    // Check singleton cache
    if (this.singletons.has(name)) {
      return this.singletons.get(name);
    }
    
    // Get service config
    const config = this.services.get(name);
    if (!config) {
      throw new Error(`Service not registered: ${name}`);
    }
    
    // Circular dependency check
    if (this.resolving.has(name)) {
      throw new Error(`Circular dependency detected: ${name}`);
    }
    
    this.resolving.add(name);
    
    try {
      // Resolve dependencies
      const depInstances = config.deps.map(dep => this.resolve(dep));
      
      // Create instance
      const instance = config.factory(...depInstances);
      
      // Cache if singleton
      if (config.singleton) {
        this.singletons.set(name, instance);
      }
      
      return instance;
    } finally {
      this.resolving.delete(name);
    }
  }
  
  /**
   * Check if service is registered
   */
  has(name) {
    return this.services.has(name);
  }
  
  /**
   * Reset container (for testing)
   */
  reset() {
    this.services.clear();
    this.singletons.clear();
    this.resolving.clear();
  }
  
  /**
   * Get all registered service names
   */
  getRegisteredNames() {
    return Array.from(this.services.keys());
  }
}

// Global instance
export const container = new Container();
```

### Step 3: Create ServiceRegistry (GREEN Part 2)

**File:** `www/js/core/ServiceRegistry.js`

```javascript
import { container } from './Container.js';
import { bus } from '../eventBus.js';
import { featureFlags } from '../config.js';

/**
 * Register all core services with the container
 * Called at app startup
 */
export function registerCoreServices() {
  // EventBus (singleton, no deps)
  container.register(
    'EventBus',
    () => bus,
    [],
    true
  );
  
  // DataService (singleton, no deps)
  // Will be registered when dataService.js is converted
  
  // State (singleton, depends on EventBus and DataService)
  // Will be registered when state.js is converted
  
  console.log('[Container] Core services registered:', container.getRegisteredNames());
}

/**
 * Register service dynamically (used by plugins)
 */
export function registerService(name, factory, deps = [], singleton = false) {
  if (container.has(name)) {
    console.warn(`[Container] Service already registered: ${name}`);
    return;
  }
  container.register(name, factory, deps, singleton);
}

/**
 * Get service instance
 */
export function getService(name) {
  try {
    return container.resolve(name);
  } catch (e) {
    console.error(`[Container] Failed to resolve: ${name}`, e);
    throw e;
  }
}
```

### Step 4: Run Tests (GREEN)

```bash
npm test tests/core/test-container.test.js
# Expected: 12 tests pass

npm test
# Expected: All 37 tests pass (25 previous + 12 new)
```

### Step 5: Update app.js (REFACTOR)

**File:** `www/js/app.js` (MODIFY existing)

```javascript
// OLD (before):
import { state } from './state.js';
import { dataService } from './dataService.js';
// ... manual initialization

// NEW (after):
import { featureFlags } from './config.js';
import { registerCoreServices } from './core/ServiceRegistry.js';

async function init() {
  // Initialize container
  if (featureFlags.USE_DI_CONTAINER) {
    registerCoreServices();
    console.log('[App] Using DI Container');
  }
  
  // Legacy initialization (feature flag OFF)
  const { state } = await import('./state.js');
  const { dataService } = await import('./dataService.js');
  // ... rest of existing code
}

init();
```

---

## Acceptance Criteria

- [ ] 37 total tests passing (25 previous + 12 new)
- [ ] Container resolves simple services
- [ ] Container resolves services with dependencies
- [ ] Singletons return same instance
- [ ] Transients return new instances
- [ ] Circular dependencies throw error
- [ ] Application runs with feature flag ON and OFF
- [ ] No functional changes to UI

---

## Manual Testing

```bash
source .venv/bin/activate
uvicorn planner:app --reload
```

**Test 1: Container OFF (default)**
```javascript
// In www/js/config.js
export const featureFlags = {
  USE_DI_CONTAINER: false,
  // ...
};
```
Open app → All features work (legacy path)

**Test 2: Container ON**
```javascript
// In www/js/config.js
export const featureFlags = {
  USE_DI_CONTAINER: true,
  // ...
};
```
Open app → Should see console: "[Container] Core services registered: ['EventBus']"

**Test 3: Resolve in console**
```javascript
import('./js/core/ServiceRegistry.js').then(m => {
  const bus = m.getService('EventBus');
  console.log('EventBus:', bus);
  bus.emit('test:event', { msg: 'from container' });
});
```

---

## Verification Checklist

- [ ] Container resolves EventBus singleton
- [ ] Same EventBus instance returned on multiple calls
- [ ] Circular dependency error triggers correctly
- [ ] Container.reset() works in tests
- [ ] app.js imports container without errors
- [ ] App works with USE_DI_CONTAINER: false
- [ ] App works with USE_DI_CONTAINER: true
- [ ] No console errors on page load

---

## Common Issues

**Issue:** "Service not registered" error  
**Fix:** Ensure `registerCoreServices()` called before `getService()`

**Issue:** Tests fail with "Cannot read property 'factory'"  
**Fix:** Check service registration syntax: `register(name, factory, deps, singleton)`

**Issue:** Circular dependency not detected  
**Fix:** Verify `this.resolving` Set is checked before recursion

**Issue:** Feature flag doesn't apply  
**Fix:** Clear browser cache, check config.js exports correctly

---

## Next Phase

After Phase 2 complete → Phase 3: ScenarioManager Extraction (critical phase)

---

## Reference Files

- AGENT_ARCHITECTURE_2.md (Phase 2 section)
- AGENT_QUICK_REFERENCE.md (DI patterns)
- tests/core/test-container.test.js (full test examples)
