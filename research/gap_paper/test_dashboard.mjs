// Temporary localhost server and synthetic paper account only. No market-data calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';

const directory = await mkdtemp(path.join(tmpdir(), 'gap-paper-dashboard-'));
const secret = randomBytes(32).toString('hex');
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ members: [], comparable: {} }));
await writeFile(path.join(directory, 'calendar.json'), '{}');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: process.cwd(),
  env: { ...process.env, AUTH_SECRET: secret, UPSTOX_ANALYTICS_TOKEN: '', GAP_PAPER_LOCAL: '1', GAP_PAPER_DB: path.join(directory, 'paper.sqlite'), GAP_PAPER_MANIFEST: path.join(directory, 'manifest.json'), GAP_PAPER_CALENDAR: path.join(directory, 'calendar.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostics = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', b => { diagnostics = (diagnostics + b).slice(-4000); });
const base = `http://127.0.0.1:${port}`;
let passed = 0;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error('Temporary server exited before ready');
    try { await fetch(base + '/api/research/gap-paper'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(ready);
  const token = await new SignJWT({ sub: 'synthetic-test' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('2m').sign(new TextEncoder().encode(secret));
  const headers = { Authorization: `Bearer ${token}`, Origin: base, 'Content-Type': 'application/json' };
  const endpoint = base + '/api/research/gap-paper';
  assert.equal((await fetch(endpoint)).status, 401); passed++;
  let result = await fetch(endpoint, { headers });
  assert.equal(result.status, 200); assert.equal((await result.json()).data_status, 'not_initialized'); passed++;
  result = await fetch(base + '/research/gap-paper', { headers });
  assert.equal(result.status, 200); assert.match(await result.text(), /PAPER — NO LIVE ORDERS/); passed++;
  result = await fetch(endpoint, { method: 'POST', headers: { Authorization: headers.Authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset', confirm: 'RESET PAPER ACCOUNT' }) });
  assert.equal(result.status, 403); passed++;
  result = await fetch(endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://unrelated.example' }, body: JSON.stringify({ action: 'pause' }) });
  assert.equal(result.status, 403); passed++;
  result = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ action: 'place-order' }) });
  assert.equal(result.status, 400); passed++;
  result = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ action: 'reset' }) });
  assert.equal(result.status, 400); passed++;
  async function action(action, confirm) {
    const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ action, confirm }) });
    assert.equal(r.status, 200); return r.json();
  }
  const account = await action('reset', 'RESET PAPER ACCOUNT');
  assert.equal(account.cash, 200000); passed++;
  assert.equal((await action('pause')).paused, true); passed++;
  assert.equal((await action('resume')).paused, false); passed++;
  assert.notEqual((await action('reset', 'RESET PAPER ACCOUNT')).account_id, account.account_id); passed++;
  console.log(JSON.stringify({ passed, failed: 0, scope: 'localhost API and page rendering; temporary synthetic account', observer_started: false }));
} catch (error) {
  console.error(error.message); console.error(diagnostics); process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
  await rm(directory, { recursive: true, force: true });
}
