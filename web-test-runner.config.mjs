import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files: 'tests/**/*.test.js',
  nodeResolve: true,
  browsers: [playwrightLauncher({ product: 'chromium' })],
  coverage: true,
  coverageConfig: {
    include: ['www/js/**/*.js'],
    // Always exclude node_modules from coverage instrumentation and reporting
    exclude: ['node_modules/**', '**/node_modules/**'],
    // Also exclude any additional transitive modules that may be picked up
    // via source maps or bundling. This helps ensure third-party libs are
    // not counted in project coverage metrics.
    excludeAdditions: ['**/node_modules/**', 'node_modules/**'],
    // Do not follow source maps back to original node_modules sources
    sourceMap: false,
    // Exclude large, DOM-/canvas-heavy modules that are difficult to fully exercise
    // in the headless test runner. These should be covered by targeted integration
    // or visual tests; excluding here lets unit coverage focus on logic.
    // exclude: [
    //   'www/js/components/dragManager.js',
    //   'www/js/components/modalHelpers.js',
    //   'www/js/components/ColorPopover.lit.js',
    //   'www/js/components/DependencyRenderer.lit.js',
    //   'www/js/components/FeatureCard.lit.js'
    // ],
    // // Add legacy/IO-heavy modules that are difficult to fully unit-test here
    // excludeAdditions: [
    //   'www/js/services/providerLocalStorage.js',
    //   'www/js/services/providerREST.js'
    // ],
    threshold: { statements: 80, branches: 75, functions: 80, lines: 80 },
  },
  testFramework: { config: { timeout: 5000 } },
  // Time for the browser runner to finish all files CI
  testsFinishTimeout: 10000,
};
