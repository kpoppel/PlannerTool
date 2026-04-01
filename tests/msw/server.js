import { setupServer } from 'msw/node';
import { handlers } from './handlers.js';
// Create the server with the default handlers; tests can call `server.use(...)`
// to override or add handlers for specific cases.
export const server = setupServer(...handlers);

// Used in tests/setup-msw.js to control server lifecycle, but also exported for tests that want to override
export function initServer() {
  // error when a request is performed without a handler so tests fail fast
  //console.log('Starting MSW server with handlers:', handlers.map(h => h.info));
  server.listen({ onUnhandledRequest: 'error' });
}

export function resetHandlers() {
  server.resetHandlers();
}

export function closeServer() {
  server.close();
}

export default server;
