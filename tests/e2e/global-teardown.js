import fs from 'fs';
import { kill } from 'process';

export default async function globalTeardown() {
  try {
    if (fs.existsSync('tests/e2e/dev-server.pid')) {
      const pid = parseInt(fs.readFileSync('tests/e2e/dev-server.pid', 'utf8'), 10);
      if (pid) {
        try {
          process.kill(pid, 'SIGTERM');
          console.log('[global-teardown] killed dev server pid=', pid);
        } catch (err) {
          console.warn('[global-teardown] failed to kill pid', pid, err && err.message);
        }
      }
      fs.unlinkSync('tests/e2e/dev-server.pid');
    }
  } catch (e) {
    console.warn('[global-teardown] error', e && e.message);
  }
}
