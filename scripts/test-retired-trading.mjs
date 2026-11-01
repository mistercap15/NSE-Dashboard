import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { isRetiredTradingPath, RETIRED_TRADING_PATHS } from '../app/lib/retiredTrading.mjs';

const root = resolve(import.meta.dirname, '..');
const read = path => readFile(join(root, path), 'utf8');
for (const path of RETIRED_TRADING_PATHS) {
  assert.equal(isRetiredTradingPath(path), true);
  assert.equal(isRetiredTradingPath(path + '/nested'), true);
  assert.equal(isRetiredTradingPath(path + '-unrelated'), false);
}
for (const path of ['/', '/rankings', '/analysis', '/api/upstox/status', '/api/research/gap-paper', '/api/auth/login']) {
  assert.equal(isRetiredTradingPath(path), false, path);
}
const sidebar = await read('app/components/Sidebar.js');
for (const path of ['/fib', '/fib-5m', '/crypto-fib', '/protection']) {
  assert.ok(!sidebar.includes(`href: "${path}"`), path);
}
for (const path of ['fib', 'fib-5m', 'crypto-fib', 'protection', 'protection/tracked', 'protection/tracked/[id]']) {
  const source = await read(`app/${path}/page.js`);
  assert.match(source, /notFound\(\)/);
  assert.doesNotMatch(source, /fetch\(|useEffect|setInterval/);
}
for (const path of ['fib/signal', 'fib-5m/signal', 'crypto-fib/signal', 'protection', 'protection/inbox', 'bot/sync', 'bot/status', 'inside-bar/signal']) {
  const source = await read(`app/api/${path}/route.js`);
  assert.match(source, /status: 410/);
  assert.doesNotMatch(source, /fetch\(|process\.env|fetchResilient/);
}
const middleware = await read('middleware.js');
assert.ok(middleware.indexOf('if (isRetiredTradingPath') < middleware.indexOf("if(pathname==='/api/protection'"));
const archive = 'archive/trading-features';
const manifest = JSON.parse(await read(`${archive}/manifest.json`));
assert.ok(manifest.files.length >= 100);
for (const file of manifest.files) {
  const bytes = await readFile(join(root, archive, 'source', file.project, file.path + '.source'));
  assert.equal(bytes.length, file.bytes, file.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  assert.doesNotMatch(file.path, /(^|\/)\.env($|\.)|\.session$|\.pem$|\.key$|\.sqlite$|\.log$/);
}
console.log(`Retirement checks passed; ${manifest.files.length} archived files verified.`);
