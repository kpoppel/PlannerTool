import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDevServerConfig } from '../../vite.config.js';

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

  it('routes a broker-connected development instance with its registered prefix', () => {
    const config = createDevServerConfig({
      PLANNER_AUTH_INSTANCE: 'dev',
      PLANNER_AUTH_PUBLIC_URL: 'http://localhost:5173/auth/',
      PLANNER_AUTH_URL: 'http://localhost:8765/auth/',
      PLANNER_AUTH_UPSTREAM_MODE: 'mock',
      PLANNER_DEV_BACKEND_PORT: '18001',
    });
    expect(config.base).toBe('/dev/');
    const proxy = config.server.proxy;
    expect(proxy['/dev/api'].rewrite('/dev/api/auth/login/callback?state=test'))
      .toBe('/api/auth/login/callback?state=test');
    expect(proxy['/dev/admin/v1'].rewrite('/dev/admin/v1/ado')).toBe('/admin/v1/ado');
    expect(proxy['/dev/api'].target).toBe('http://localhost:18001');
    expect(proxy['/auth'].target).toBe('http://localhost:8765');
    expect(proxy['/auth'].changeOrigin).toBe(false);
    expect(config.server.strictPort).toBe(true);
    expect(config.server.host).toBe('localhost');
  });

  it('rejects live Entra development without HTTPS', () => {
    expect(() => createDevServerConfig({
      PLANNER_AUTH_INSTANCE: 'dev',
      PLANNER_AUTH_PUBLIC_URL: 'http://localhost:5173/auth/',
      PLANNER_AUTH_URL: 'http://localhost:8765/auth/',
      PLANNER_AUTH_UPSTREAM_MODE: 'entra',
    })).toThrow('HTTPS');
  });

  it('serves the admin login entry instead of the planner SPA in broker development', () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { createServer } from 'vite';
      const server = await createServer({ optimizeDeps: { noDiscovery: true, entries: [] }, server: { port: 0 } });
      await new Promise(resolve => server.httpServer.listen(0, 'localhost', resolve));
      try {
        const address = server.httpServer.address();
        const response = await fetch('http://localhost:' + address.port + '/dev/admin/login');
        const html = await response.text();
        process.stdout.write(JSON.stringify({ admin: html.includes('js/login.js'), status: response.status }));
      } finally { await server.close(); }
    `], { encoding: 'utf8', env: { ...process.env,
      PLANNER_AUTH_INSTANCE: 'dev', PLANNER_AUTH_PUBLIC_URL: 'http://localhost:5174/auth/',
      PLANNER_AUTH_URL: 'http://localhost:8765/auth/', PLANNER_AUTH_UPSTREAM_MODE: 'mock',
    } });
    expect(output).toContain('"admin":true');
    expect(output).toContain('"status":200');
  });
});

describe('Development launcher', () => {
  it('loads protected broker configuration and starts both services with the instance path', () => {
    const root = mkdtempSync(join(tmpdir(), 'planner-dev-launch-'));
    try {
      mkdirSync(join(root, 'scripts'));
      mkdirSync(join(root, 'bin'));
      mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
      copyFileSync('scripts/run_dev.sh', join(root, 'scripts/run_dev.sh'));
      writeFileSync(join(root, '.encryption_key'), 'fixture-key');
      writeFileSync(join(root, 'auth.env'), [
        'PLANNER_AUTH_INSTANCE=dev',
        'PLANNER_AUTH_PROVIDER=entra',
        'PLANNER_AUTH_UPSTREAM_MODE=mock',
        'PLANNER_AUTH_PUBLIC_URL=http://localhost:5173/auth/',
      ].join('\n'), { mode: 0o644 });
      const rejected = spawnSync('bash', ['scripts/run_dev.sh', '--auth-env', 'auth.env'], {
        cwd: root, encoding: 'utf8',
      });
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain('must not be accessible');
      chmodSync(join(root, 'auth.env'), 0o600);
      for (const command of ['uvicorn', 'npx', 'python', 'vite']) {
        const lifetime = command === 'npx' ? 'process.exit(99);' : command === 'vite'
          ? 'const fs = require("node:fs"); const check = () => fs.existsSync(process.env.CAPTURE_DIR + "/uvicorn") && fs.existsSync(process.env.CAPTURE_DIR + "/python") ? process.exit(0) : setImmediate(check); check();'
          : 'setInterval(() => {}, 1000);';
        const executable = command === 'vite'
          ? join(root, 'node_modules', '.bin', command) : join(root, 'bin', command);
        writeFileSync(executable, '#!/bin/sh\nprintf "%s %s\\n" "$PLANNER_AUTH_PROVIDER" "$*" > "$CAPTURE_DIR/' + command + '"\nexec "$NODE_BINARY" -e \'' + lifetime + '\'\n', { mode: 0o700 });
      }
      execFileSync('bash', ['scripts/run_dev.sh', '--auth-env', 'auth.env'], {
        cwd: root, env: { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH,
          CAPTURE_DIR: root, NODE_BINARY: process.execPath }, encoding: 'utf8',
      });
      expect(readFileSync(join(root, 'uvicorn'), 'utf8')).toContain('--root-path /dev');
      expect(readFileSync(join(root, 'uvicorn'), 'utf8')).toContain('--no-access-log');
      expect(readFileSync(join(root, 'python'), 'utf8')).toContain('entra-id/app.py');
      expect(readFileSync(join(root, 'vite'), 'utf8')).toContain('entra');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});