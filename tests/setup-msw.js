import { afterAll, afterEach, beforeAll } from 'vitest';
import { initServer, resetHandlers, closeServer } from './msw/server.js';

// Start MSW server before any tests run, reset handlers after each test,
// and close the server once tests finish. Tests can scope handlers by calling
// `import { server } from './msw/server.js'; server.use(...)` or by
// using `import { http } from 'msw'` in their own test files.
beforeAll(() => {
  initServer();
});

afterEach(() => {
  resetHandlers();
});

afterAll(() => {
  closeServer();
});

// Export server utilities for tests that want to apply scoped handlers.
export {
  initServer as __msw_init,
  resetHandlers as __msw_reset,
  closeServer as __msw_close,
};
