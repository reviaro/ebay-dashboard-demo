/** Built-app regression: the SAME build must fail closed when demo mode is off. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { hashPassword } from '../src/lib/auth/password';

const port = 3942;
const base = `http://127.0.0.1:${port}`;
const next = ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'];

async function stop(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.kill('SIGTERM');
  await exit;
}

async function scenario(configured: boolean) {
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  delete env.DEMO_MODE;
  delete env.DATABASE_URL;
  delete env.DASHBOARD_PASSWORD_HASH;
  delete env.DASHBOARD_SESSION_SECRET;
  if (configured) {
    // Disposable, process-local fixture credentials, never printed or saved.
    env.DASHBOARD_PASSWORD_HASH = hashPassword(randomBytes(24).toString('hex'));
    env.DASHBOARD_SESSION_SECRET = randomBytes(32).toString('base64');
  }
  const child = spawn(process.execPath, next, { env, stdio: 'ignore' });
  try {
    let ready = false;
    for (let tries = 0; tries < 100; tries++) {
      if (child.exitCode !== null) throw new Error('Auth smoke server exited before readiness.');
      try { await fetch(`${base}/api/auth/session`, { signal: AbortSignal.timeout(1000) }); ready = true; break; } catch { await delay(100); }
    }
    assert.ok(ready, 'Auth smoke server became ready');
    for (const path of ['/', '/orders', '/?demo=1', '/?DEMO_MODE=1']) {
      const response = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, configured ? 307 : 503, `${path} remains authenticated`);
      assert.equal(response.headers.get('x-demo-mode'), null);
      if (configured) assert.ok(response.headers.get('location')?.includes('/login?'));
    }
    for (const path of ['/api/tasks', '/api/tasks?demo=1']) {
      const api = await fetch(base + path, { signal: AbortSignal.timeout(5000), headers: { Cookie: 'demo=1' } });
      assert.equal(api.status, configured ? 401 : 503, 'Normal API remains gated');
    }
    const probe = await fetch(`${base}/api/auth/session`, { signal: AbortSignal.timeout(5000) });
    assert.equal(probe.status, configured ? 200 : 503);
    assert.deepEqual(await probe.json(), configured ? { authenticated: false, configured, user: null } : { authenticated: false, configured });
    assert.equal((await fetch(`${base}/login`, { signal: AbortSignal.timeout(5000) })).status, 200);
    console.log(`PASS normal mode ${configured ? 'configured but unauthenticated' : 'missing authentication configuration'}`);
  } finally {
    await stop(child);
  }
}

async function rejectsDemoStartup(args: string[], database: string, expected: RegExp) {
  const child = spawn(process.execPath, [...args, ...next], {
    env: { ...process.env, DEMO_MODE: '1', DATABASE_URL: database, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { errors += chunk; });
  try {
    const [status] = await once(child, 'close', { signal: AbortSignal.timeout(10_000) });
    assert.equal(status, 1, 'Unsafe demo startup must exit with status 1');
    assert.match(errors, expected);
  } finally {
    await stop(child);
  }
}

await scenario(false);
await scenario(true);
await rejectsDemoStartup([], 'file:./rejected.db', /only accepts DATABASE_URL=file:\.\/demo\.db/);
console.log('PASS demo startup refuses an alternate database URL and exits');
await rejectsDemoStartup(['--import', 'data:text/javascript,process.getuid%20%3D%20()%20%3D%3E%200'], 'file:./demo.db', /must run as a non-root user/);
console.log('PASS demo startup refuses root and exits (simulated uid 0)');
