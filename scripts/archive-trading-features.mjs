// One-time source preservation. Never reads credentials or runtime state.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const dashboard = resolve(import.meta.dirname, '..');
const projects = dirname(dashboard);
const destination = join(dashboard, 'archive/trading-features');
const manifest = [];
async function preserve(project, relative) {
  const bytes = await readFile(join(projects, project, relative));
  const output = join(destination, 'source', project, relative + '.source');
  await mkdir(dirname(output), { recursive: true });
  // Exclusive creation prevents accidentally replacing the pre-retirement copy.
  await writeFile(output, bytes, { flag: 'wx' });
  manifest.push({ project, path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
async function tree(project, relative) {
  for (const entry of await readdir(join(projects, project, relative), { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue;
    const path = join(relative, entry.name);
    if (entry.isDirectory()) await tree(project, path);
    else if (entry.isFile()) await preserve(project, path);
  }
}
for (const path of ['app/fib', 'app/fib-5m', 'app/crypto-fib', 'app/protection', 'app/api/fib', 'app/api/fib-5m', 'app/api/crypto-fib', 'app/api/protection', 'app/api/bot', 'app/api/inside-bar', 'research/hedge_inbox']) await tree('nse-dashboard', path);
for (const path of ['app/lib/fib.js', 'app/lib/insideBar.js', 'app/lib/deltaCandles.js', 'app/lib/protection.mjs', 'app/lib/hedgeAdvice.mjs', 'app/lib/hedgeContext.mjs', 'app/lib/hedgeSummary.mjs', 'app/components/Sidebar.js', 'middleware.js', 'package.json']) await preserve('nse-dashboard', path);
for (const path of ['scripts/test-fib.mjs', 'scripts/test-inside-bar.mjs', 'scripts/test-protection.mjs', 'scripts/test-hedge-advice.mjs', 'scripts/test-hedge-context.mjs', 'scripts/test-hedge-summary.mjs']) await preserve('nse-dashboard', path);
for (const path of ['app/research/fib-bot.tsx', 'app/research/fib-5m.tsx', 'app/research/crypto-fib.tsx', 'app/research/protection.tsx', 'app/research/protection-detail.tsx', 'app/research/protection-tracked.tsx', 'components/BotLiveState.tsx', 'components/HedgeGuidance.tsx', 'components/HedgeInbox.tsx', 'components/ProtectionDetails.tsx', 'lib/queries.ts', 'lib/types.ts', 'app/(tabs)/research.tsx', 'app/_layout.tsx', 'app.json', 'eas.json', 'package.json']) await preserve('nse-mobile', path);
const executorFiles = execFileSync('git', ['ls-files', '-z'], { cwd: join(projects, 'nifty-executor') }).toString().split('\0').filter(Boolean);
for (const path of executorFiles) {
  if (path.startsWith('.env') || path.endsWith('.pem') || path.endsWith('.key')) continue;
  await preserve('nifty-executor', path);
}
// The separate, non-Git crypto research project: source only, not sessions/logs/data.
for (const entry of await readdir(join(projects, 'crypto-bot'), { withFileTypes: true })) {
  if (entry.isFile() && /\.(py|md)$/.test(entry.name)) await preserve('crypto-bot', entry.name);
}
await writeFile(join(destination, 'manifest.json'), JSON.stringify({ date: '2026-11-01', files: manifest }, null, 2) + '\n', { flag: 'wx' });
console.log(`Preserved ${manifest.length} source files in ${destination}`);
