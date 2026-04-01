# MSW test server for PlannerTool

## Purpose

Provide a scoped mock HTTP server for Vitest tests so components receive realistic
fixtures rather than empty arrays/objects. The server is conservative by default
and returns 404 for unhandled requests to surface missing handlers.

## Setup

1. Install MSW as a dev dependency:

```bash
npm install msw --save-dev
```

2. `vitest.config.js` is already updated to include `tests/setup-msw.js`.

## Usage patterns

- Global defaults are defined in `tests/msw/handlers.js`.
- In a specific test file, scope handlers with `server.use(...)` to override
  responses for that test only.

Example per-test override:

```js
import { server } from './msw/server.js';
import { rest } from 'msw';

test('provider returns features from MSW handler', async () => {
  server.use(
    rest.get('/api/features', (req, res, ctx) =>
      res(ctx.status(200), ctx.json([{ id: 'X1', title: 'X' }]))
    )
  );

  // run code that performs fetch('/api/features') and assert results
});
```

## Notes

- Keep tests deterministic by explicitly scoping handlers for non-trivial
  interactions. The default handlers are intentionally conservative and return
  404 for unknown endpoints so missing mocks don't silently pass.
