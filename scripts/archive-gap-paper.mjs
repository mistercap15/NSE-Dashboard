// Append the follow-up retirement without replacing earlier frozen source copies.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const archive = join(root, 'archive/trading-features');
const manifestPath = join(archive, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const additions = [];
async function preserve(project, path) {
  const source = join(dirname(root), project);
  const bytes = await readFile(join(source, path));
  const previous = manifest.files.find(file => file.project === project && file.path === path);
  if (previous) {
    if (createHash('sha256').update(bytes).digest('hex') !== previous.sha256) throw new Error(`Refusing to replace frozen source: ${project}/${path}`);
    return;
  }
  const target = join(archive, 'source', project, path + '.source');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
  additions.push({ project, path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const paths = execFileSync('git', ['ls-files', '-z', 'research/gap_paper', 'app/research/gap-paper', 'app/api/research/gap-paper', 'app/lib/gapPaperPilot.json', 'app/lib/gapPaperRemote.js'], { cwd: root }).toString().split('\0').filter(Boolean);
for (const path of paths) await preserve('nse-dashboard', path);
for (const path of ['app/research/gap-paper.tsx', 'app/research/gap-paper-history.tsx', 'components/GapComparison.tsx', 'components/GapSessionStatus.tsx', 'lib/gapPaper.ts', 'assets/data/gapPaperPilot.json']) await preserve('nse-mobile', path);
const revisions = {};
for (const project of ['nse-dashboard', 'nse-mobile']) revisions[project] = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(dirname(root), project) }).toString().trim();
manifest.files.push(...additions);
manifest.supplements = [...(manifest.supplements || []), { feature: 'Gap Pullback Paper', date: '2026-11-01', revisions, files: additions.length }];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Appended ${additions.length} Gap Pullback Paper files; archive now contains ${manifest.files.length} verified source files.`);
