import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { paperRemote } from '../../../lib/gapPaperRemote';
const run = promisify(execFile);
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function invoke(command, reset = false) {
  if (process.env.GAP_PAPER_LOCAL !== '1') return { mode: 'paper', data_status: 'disabled', message: 'Local paper storage is disabled. Follow research/gap_paper/README.md; no observer starts from this page.' };
  const base = path.join(process.cwd(), 'data/exports/gap_paper');
  const args = ['-m', 'research.gap_paper.cli', command, '--db', process.env.GAP_PAPER_DB || path.join(base, 'paper.sqlite')];
  if (command !== 'status') {
    if (!process.env.GAP_PAPER_MANIFEST || !process.env.GAP_PAPER_CALENDAR) throw new Error('Configure reviewed GAP_PAPER_MANIFEST and GAP_PAPER_CALENDAR paths');
    args.push('--manifest', process.env.GAP_PAPER_MANIFEST, '--calendar', process.env.GAP_PAPER_CALENDAR);
    if (reset) args.push('--confirm-reset');
  }
  const { stdout } = await run(process.env.GAP_PAPER_PYTHON || 'python3', args, { cwd: process.cwd(), timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}
export async function GET(request) {
  try {
    const day = request ? new URL(request.url).searchParams.get('day') : null;
    const result = process.env.GAP_PAPER_URL ? await paperRemote('status', { day }) : await invoke('status');
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Paper storage unavailable. Check local configuration and research CLI.' }, { status: 503 }); }
}
export async function POST(request) {
  const origin = request.headers.get('origin');
  let sameOrigin = false;
  try {
    const source = new URL(origin);
    // Next may normalize request.url's hostname; Host preserves the browser-facing authority.
    sameOrigin = origin === source.origin && source.host === request.headers.get('host') && source.protocol === new URL(request.url).protocol;
  } catch {}
  if (!sameOrigin) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403 });
  if (!process.env.GAP_PAPER_URL && process.env.GAP_PAPER_LOCAL !== '1') return NextResponse.json({ error: 'Local paper mode disabled' }, { status: 409 });
  try {
    const body = await request.json();
    if (!['pause', 'resume', 'reset'].includes(body.action)) return NextResponse.json({ error: 'Invalid paper action' }, { status: 400 });
    if (body.action === 'reset' && body.confirm !== 'RESET PAPER ACCOUNT') return NextResponse.json({ error: 'Explicit reset confirmation required' }, { status: 400 });
    return NextResponse.json(process.env.GAP_PAPER_URL ? await paperRemote('control', { body }) : await invoke(body.action, body.action === 'reset'));
  } catch { return NextResponse.json({ error: 'Paper operation failed; account was not partially updated. Check CLI configuration.' }, { status: 409 }); }
}
