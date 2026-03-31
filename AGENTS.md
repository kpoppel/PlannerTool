AGENTS FOR AUTOMATED CONTRIBUTORS

This file tells agentic coding assistants how to build, test and follow code style in this repository.
Keep changes here short and machine-friendly — agents will rely on these rules when editing files.

1. Build / lint / test commands

- Install JS deps: `npm install` (uses package.json)
- Run unit tests (fast, jsdom): `npm test` or `npx vitest`
- Run a single Vitest test file: `npx vitest tests/path/to/file.test.js`
- Run a single test by name (pattern): `npx vitest -t "My test name or partial"`
- Run tests and collect coverage: `npm run test:coverage` or `npx vitest run --coverage`
- Interactive UI/debug Vitest in browser: `npm run test:ui` (uses @vitest/browser)
- Run web-test-runner browser tests (Playwright launcher): `npx web-test-runner --config web-test-runner.config.mjs` (useful for legacy browser tests)
- Run Playwright e2e tests (example):
  `npx playwright test --config=playwright.smoke.config.js --project=chromium`
- Build frontend bundle: `npm run build` (uses Vite)
- Build vendor bundle: `npm run build:vendor` (uses Rollup)

Notes & examples for selecting tests

- To run a single test file with npm scripts: `npm test -- tests/my.test.js`
- To run a single test case by name (Vitest): `npx vitest -t "should do X"`
- To run tests matching a file glob: `npx vitest "tests/**/foo*.test.js"`

2. Repo layout pointers

- Backend: Python server at `planner.py` / `planner-dev.py` and Python requirements in `requirements.txt`.
- Frontend: `www/js/` and `www-admin/js/` and modern bundling via `vite.config.js`, `rollup.config.mjs`.
- Tests: `tests/` (unit), `tests/e2e/` (end-to-end / browser). Vitest config: `vitest.config.js`.

3. Code style guidelines (apply these consistently)

General

- Prefer clear, small commits with focused scope. Write concise commit messages describing "why".
- Use English for identifiers, comments and commit messages. Keep comments factual and short.

JavaScript / frontend

- Module system: ES modules only (use `import` / `export`). `type: "module"` is set in package.json.
- Use `const` for values that do not change, otherwise `let`. Do not use `var`.
- Naming:
  - Functions/variables: `camelCase`
  - Constants (top-level constant values): `UPPER_SNAKE_CASE` or `camelCase` when more descriptive
  - Classes / Custom Elements / Web Components: `PascalCase` and element file name should end with `.lit.js` when using Lit (e.g. `FeatureCard.lit.js` / `class FeatureCard extends LitElement`)
  - Event handlers: prefix with `on` (e.g. `_onClick`, `_onStateSelect`)
- File names: follow existing convention: components use `.lit.js`, services in `www/js/services/*.js` use lower/mixed-case.
- Imports: group and order imports logically: external packages first, then project relative imports. Keep imports sorted within groups when reasonable.
- Keep import paths explicit and avoid deep relative chains (use clear relative paths like `../services/foo.js`).
- Prefer named exports for library utilities and default export only for a single primary item in a file.

Formatting and tooling

- No project-wide Prettier or ESLint config is required in this repository; however follow these practical defaults:
  - Use 2 spaces for indentation in JS files to match existing files
  - Keep line length ~100 characters where possible
  - Trailing semicolons are allowed; be consistent with neighboring code
  - Use single quotes for strings in JS unless template literals are required
- When making many formatting edits, limit changes to files you touch to ease code review.

Types and documentation

- This repo is JavaScript-first. Do not convert modules to TypeScript without an explicit task.
- Prefer JSDoc for function/type hints where the input/output shape is non-obvious.
  - Example:
    /\*\*
    - Compute capacity for a feature
    - @param {{team:string,capacity:number}[]} capacity
    - @returns {number}
      \*/
      function totalCapacity(capacity){...}

Testing

- Tests are written with Vitest and some browser harnesses. Keep tests small and deterministic.
- Use `beforeEach` / `afterEach` to reset DOM or stubs. Use `setupFiles` in `vitest.config.js` for global setup.
- Avoid network calls in unit tests; mock network providers (see `www/js/services/providerMock.js` pattern).

Error handling and logging

- Fail fast: validate inputs and throw informative exceptions rather than returning undefined sentinel values.
- When catching errors, only catch if you can handle or wrap and rethrow with context.
  - Bad: `try{...}catch(e){}` (silently swallow)
  - Good: `catch (e) { console.error('Saving scenario failed', {id, err:e}); throw e; }`
- For user-facing errors (frontend), show concise messages and preserve original error in logs.
- Backend (Python): follow existing patterns — raise exceptions for unexpected states and return clear status codes via HTTP handlers.

Performance and safety

- Avoid creating large in-memory copies of application state during transforms; prefer streaming or map/filter where possible.
- Prefer explicit cloning (structuredClone / JSON) only when needed and document the reason.

Security

- Do not hardcode credentials or secrets in repository. Use environment variables and config ymls under `data/config`.

Cursor & Copilot rules

- Cursor rules (.cursor/rules or .cursorrules): none found in this repo. If added, include their path here and follow their precedence.
- GitHub Copilot instructions (.github/copilot-instructions.md): none found. If such file is added, agents must follow those instructions.

Contributing / PRs

- Keep changes atomic and focused. When adding or modifying behavior, include or update tests.
- Update `docs/` when changing public APIs or data shape.

Agent behaviour summary (short)

- Prefer minimal, focused changes. Run unit tests locally (`npx vitest -t "pattern"` or `npx vitest path/to/file`) before pushing.
- Make edits using ES modules style, stick to naming conventions, and add JSDoc for non-obvious shapes.
- Do not convert JS to TS unless requested. Do not add new dependencies without explicit approval.

Where to ask questions

- Open an issue or add an inline TODO comment when a behavior is ambiguous. Keep the comment short and actionable.

End of file
