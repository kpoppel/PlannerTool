## Testable Frontend Modules

The following modules in `www/js/` are suitable for console-based testing (minimal DOM dependencies):

- colorManager.js
- colorSimpleManager.js
- providerLocalStorage.js
- dataService.js
- eventBus.js
- providerLocalStorage.js
- providerMock.js
- providerREST.js
- scheduleService.js
- state.js
- util.js

Modules with significant DOM/UI logic (e.g., modal.js, sidebar.js, detailsPanel.js, dragManager.js, featureCard.js, timeline.js, loadGraph.js, loadMath.js, app.js) are less suitable for pure console tests and may require browser or DOM mocks.

## Test Conventions & Runner Usage

- Each test file should import the target module from `../../www/js/`.
- Use simple assertion helpers (e.g., `assertEqual`) and log results to the console.
- Tests should avoid direct DOM manipulation; focus on pure logic and data functions.
- To run all tests, use:

	```bash
	node scripts/run_js_tests.mjs
	```

- The runner will execute all `test-*.js` files in this directory and report results in the console.

Add new test files as `test-<module>.js` for each module you wish to cover.
