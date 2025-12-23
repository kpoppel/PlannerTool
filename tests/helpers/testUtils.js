/**
 * Test Utilities
 * Helper functions for writing tests
 */

/**
 * Wait for a condition to be true
 * @param {Function} condition - Function that returns boolean
 * @param {number} timeout - Max wait time in ms
 * @returns {Promise<void>}
 */
export async function waitFor(condition, timeout = 1000) {
  const startTime = Date.now();
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/**
 * Wait for an event to be emitted
 * @param {Object} eventBus - EventBus instance
 * @param {string} eventName - Event to wait for
 * @param {number} timeout - Max wait time in ms
 * @returns {Promise<any>} Event payload
 */
export function waitForEvent(eventBus, eventName, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);
    
    const unsubscribe = eventBus.on(eventName, (payload) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(payload);
    });
  });
}

/**
 * Create a mock DOM element
 * @param {string} tag - Element tag name
 * @param {Object} props - Element properties
 * @returns {HTMLElement}
 */
export function createMockElement(tag, props = {}) {
  const element = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === 'textContent') {
      element.textContent = value;
    } else if (key === 'className') {
      element.className = value;
    } else {
      element.setAttribute(key, value);
    }
  });
  return element;
}

/**
 * Create a spy for testing function calls
 * @param {Object} obj - Object containing the method
 * @param {string} method - Method name to spy on
 * @returns {Function} Original method (for restoration)
 */
export function spyOn(obj, method) {
  const original = obj[method];
  const calls = [];
  
  obj[method] = function(...args) {
    calls.push(args);
    return original.apply(this, args);
  };
  
  obj[method].calls = calls;
  obj[method].restore = () => {
    obj[method] = original;
  };
  
  return obj[method];
}
