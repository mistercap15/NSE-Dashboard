// Retirement smoke test only: no account, scanner, market data or credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostics = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-4000); });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Temporary server exited before ready');
    try { await fetch(base + '/login'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(ready, 'Server ready');
  for (const path of ['/api/research/gap-paper', '/api/research/gap-paper/pilot']) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(base + path, { method });
      assert.equal(response.status, 410, `${method} ${path}`);
      assert.equal((await response.json()).code, 'FEATURE_RETIRED');
    }
  }
  const response = await fetch(base + '/research/gap-paper', { redirect: 'manual' });
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location'), base).pathname, '/');
  console.log('Gap Paper retirement HTTP checks passed: 10 API refusals and Overview redirect.');
} catch (error) {
  console.error(diagnostics);
  throw error;
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
  console.log('Temporary verification server stopped.');
}
