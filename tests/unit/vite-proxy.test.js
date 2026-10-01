import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const proxy = JSON.parse(execFileSync(process.execPath, [
  '--input-type=module', '-e',
  [
    "import { loadConfigFromFile } from 'vite';",
    "const result = await loadConfigFromFile({ command: 'serve', mode: 'development' });",
    'process.stdout.write(JSON.stringify(result.config.server.proxy));',
  ].join(' '),
], { cwd: process.cwd(), encoding: 'utf8' }));

describe('Vite cookie-auth proxy', () => {
  it.each(['/api', '/admin/v1'])('preserves the browser Host for %s requests', (route) => {
    expect(proxy[route].changeOrigin).toBe(false);
  });
});