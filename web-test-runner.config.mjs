// web-test-runner configuration: run unit tests in Node by default
export default {
  // Discover test files under `tests/`
  files: ["tests/**/*.test.js"],

  // Prefer Node execution to avoid requiring a browser binary in CI/local shells.
  node: true,

  // Resolve bare imports (allows importing from `lit`, etc.)
  nodeResolve: true,

  // Don't auto-launch browser runners by default; Node is preferred for unit tests.
  browsers: [],

  // Quiet by default; callers can pass --verbose if needed.
  concurrentBrowsers: 1,
};
