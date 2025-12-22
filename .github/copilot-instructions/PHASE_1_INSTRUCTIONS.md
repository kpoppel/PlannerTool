# Phase 1: Enhanced EventBus - Copilot Instructions

**Duration:** 2 days  
**Status:** Not Started  
**Prerequisites:** Phase 0 complete (test infrastructure ready)

---

## Objective

Enhance EventBus with typed events, wildcards, and adapters while maintaining 100% backward compatibility with string-based events.

---

## Deliverables

1. ✅ EventRegistry with typed event constants (Symbols)
2. ✅ Enhanced EventBus with type mapping
3. ✅ Wildcard listener support (e.g., 'feature:*')
4. ✅ Backward compatible with all existing string events
5. ✅ 15 new tests passing (25 total)
6. ✅ Feature flag: USE_TYPED_EVENTS

---

## TDD Workflow

### Step 1: Write Failing Tests (RED)

**File:** `tests/core/test-enhanced-event-bus.test.js`

Required test cases:
- String events still work (backward compat)
- Typed events emit and receive
- Typed events map to string events
- Wildcard subscriptions work (feature:*)
- Unsubscribe from wildcards
- Error handling for undefined mappings

**Expected:** Tests FAIL (RED) - EventRegistry and enhanced methods don't exist

### Step 2: Create EventRegistry (GREEN Part 1)

**File:** `www/js/core/EventRegistry.js`

Create typed event constants:
```javascript
export const FeatureEvents = {
  UPDATED: Symbol('feature:updated'),
  CREATED: Symbol('feature:created'),
  DELETED: Symbol('feature:deleted'),
  DATES_CHANGED: Symbol('feature:dates-changed'),
  SELECTED: Symbol('feature:selected')
};

export const ScenarioEvents = {
  ACTIVATED: Symbol('scenario:activated'),
  SAVED: Symbol('scenario:saved'),
  CREATED: Symbol('scenario:created'),
  DELETED: Symbol('scenario:deleted'),
  UPDATED: Symbol('scenario:updated')
};

// ... more event groups

export const EVENT_TYPE_MAP = new Map([
  [FeatureEvents.UPDATED, 'feature:updated'],
  [FeatureEvents.CREATED, 'feature:created'],
  // ... all mappings
]);

export function registerEventTypes(eventBus) {
  EVENT_TYPE_MAP.forEach((str, type) => {
    eventBus.registerEventType(type, str);
  });
}
```

### Step 3: Enhance EventBus (GREEN Part 2)

**File:** `www/js/eventBus.js` (MODIFY existing)

Add to EventBus class:
```javascript
export class EventBus {
  constructor() { 
    this.listeners = new Map(); 
    this.eventTypeMap = new Map(); // NEW
  }
  
  // NEW: Register typed event mapping
  registerEventType(typeConstant, stringEvent) {
    this.eventTypeMap.set(typeConstant, stringEvent);
  }
  
  // NEW: Convert event to string
  _toEventString(event) {
    if (typeof event === 'string') return event;
    if (this.eventTypeMap.has(event)) return this.eventTypeMap.get(event);
    return event.toString();
  }
  
  // NEW: Get wildcard key
  _getWildcardKey(eventStr) {
    const parts = eventStr.split(':');
    return parts.length > 1 ? parts[0] + ':*' : null;
  }
  
  // ENHANCED: Accept string or typed
  on(event, handler) { 
    const eventStr = this._toEventString(event);
    if (!this.listeners.has(eventStr)) {
      this.listeners.set(eventStr, new Set());
    }
    this.listeners.get(eventStr).add(handler); 
    return () => this.off(eventStr, handler);
  }
  
  // ENHANCED: Support wildcards
  emit(event, payload) { 
    const eventStr = this._toEventString(event);
    
    // Exact match listeners
    if (this.listeners.has(eventStr)) { 
      for (const h of this.listeners.get(eventStr)) { 
        try { h(payload); } 
        catch (e) { console.error('Event handler error', eventStr, e); } 
      } 
    }
    
    // Wildcard listeners (NEW)
    const wildcardKey = this._getWildcardKey(eventStr);
    if (wildcardKey && this.listeners.has(wildcardKey)) {
      for (const h of this.listeners.get(wildcardKey)) {
        try { h(payload); }
        catch (e) { console.error('Wildcard handler error', wildcardKey, e); }
      }
    }
  }
  
  off(event, handler) { 
    const eventStr = this._toEventString(event);
    if (this.listeners.has(eventStr)) {
      this.listeners.get(eventStr).delete(handler);
    }
  }
}

export const bus = new EventBus();

// Auto-register event types
try {
  const { registerEventTypes } = await import('./core/EventRegistry.js');
  registerEventTypes(bus);
} catch (e) {
  console.warn('EventRegistry not found');
}
```

### Step 4: Run Tests (GREEN)

```bash
npm test tests/core/test-enhanced-event-bus.test.js
# Expected: 15 tests pass

npm test
# Expected: All 25 tests pass (10 baseline + 15 new)
```

---

## Feature Flag Setup

**File:** `www/js/config.js` (NEW)

```javascript
export const featureFlags = {
  USE_TYPED_EVENTS: false,
  WARN_ON_STRING_EVENTS: false,
  LOG_EVENT_HISTORY: false,
  
  // Future phases
  USE_SCENARIO_SERVICE: false,
  USE_FILTER_SERVICE: false,
  USE_CAPACITY_SERVICE: false,
  
  // Runtime override
  ...(typeof window !== 'undefined' && window.__featureFlags ? window.__featureFlags : {})
};
```

---

## Acceptance Criteria

- [ ] 25 total tests passing (10 baseline + 15 new)
- [ ] All existing string events still work
- [ ] Typed events work when imported
- [ ] Wildcard listeners functional
- [ ] No changes to existing event emitters
- [ ] Application runs identically
- [ ] Manual test: toggle filters, create scenarios (all work)

---

## Manual Testing

```bash
source .venv/bin/activate
uvicorn planner:app --reload
```

Open browser console:
```javascript
// Test 1: String events (existing)
bus.emit('feature:updated', { id: '123' });

// Test 2: Typed events (new)
import('./js/core/EventRegistry.js').then(m => {
  bus.emit(m.FeatureEvents.UPDATED, { id: '456' });
});

// Test 3: Wildcard
bus.on('feature:*', data => console.log('Wildcard:', data));
bus.emit('feature:created', { id: '789' });
```

---

## Verification Checklist

- [ ] String events work everywhere (no regressions)
- [ ] Typed events map correctly to strings
- [ ] Both string and typed listeners receive events
- [ ] Wildcard patterns match correctly (feature:*)
- [ ] Wildcard doesn't match other namespaces (scenario:*)
- [ ] Unsubscribe works for all types
- [ ] No console errors on page load
- [ ] All baseline tests still pass

---

## Common Issues

**Issue:** Import error for EventRegistry  
**Fix:** Use dynamic import with try/catch in eventBus.js

**Issue:** Tests fail with "Symbol not defined"  
**Fix:** Import EventRegistry in test file

**Issue:** Wildcard not triggering  
**Fix:** Ensure event uses ':' separator

---

## Next Phase

After Phase 1 complete → Phase 2: DI Container

---

## Reference Files

- AGENT_PHASE_1_GUIDE.md (detailed guide with full code)
- AGENT_ARCHITECTURE_2.md (Phase 1 section)
- AGENT_QUICK_REFERENCE.md (event bus patterns)
