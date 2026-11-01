// Dedicated paper-service transport. Never forwards broker credentials or order requests.
export async function paperRemote(action, { day, body } = {}) {
  const base = process.env.GAP_PAPER_URL;
  const secret = process.env.GAP_PAPER_HTTP_SECRET;
  if (!base || !secret) throw new Error('Paper service connection is not configured');
  const url = new URL(action === 'status' ? '/state' : '/control', base);
  if (url.protocol !== 'https:' && !['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('Paper service requires HTTPS');
  if (day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid date');
    url.searchParams.set('day', day);
  }
  const response = await fetch(url, {
    method: action === 'status' ? 'GET' : 'POST',
    headers: { 'X-Paper-Secret': secret, Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(action === 'status' ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Paper service request failed');
  return response.json();
}
