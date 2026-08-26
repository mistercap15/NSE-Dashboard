// ─────────────────────────────────────────────────────────────────────────────
// fetch(), with a way through when the platform's DNS resolver is the problem.
//
// WHY THIS EXISTS. The sync button began failing with "fetch failed", which
// turned out to be ENOTFOUND on the droplet's Tailscale Funnel hostname. The
// name itself was healthy — four public resolvers answered it 20/20, the
// authoritative servers returned clean A records, DNSSEC validated — but
// Vercel's Lambda resolver intermittently could not resolve the `ts.net` zone,
// and once a lookup failed it negative-cached, so failures arrived in runs
// rather than flickers. Nothing on the droplet was wrong and nothing in the
// dashboard's configuration was wrong; the resolver in between was.
//
// That is not a thing this app can fix at its source, and retrying does not help
// while a negative answer is cached. So when — and only when — a fetch fails for
// a DNS reason, resolve the name over DNS-over-HTTPS and connect straight to the
// resulting address.
//
// The DoH providers are addressed by literal IP with an explicit SNI, so this
// path needs no name resolution to bootstrap itself. That is the whole point: a
// fallback that depended on DNS would fail in exactly the situation it exists
// for.
//
// TLS IS STILL FULLY VERIFIED. Connecting by address does not mean trusting
// blindly: `servername` drives both SNI and the certificate identity check, so
// the certificate must still be valid for the original hostname. An attacker who
// could poison DNS would still not get a trusted certificate. `rejectUnauthorized`
// is never relaxed — this file must never grow such an option.
// ─────────────────────────────────────────────────────────────────────────────
import https from "node:https";

/** Failures worth re-attempting by address. Everything else is a real error —
 *  a refused connection or a bad certificate means the name resolved fine. */
const DNS_ERRORS = new Set(["ENOTFOUND", "EAI_AGAIN", "ENODATA"]);

/** Reached by IP, verified against their own names. */
const DOH_PROVIDERS = [
  { ip: "8.8.8.8", host: "dns.google", path: "/resolve" },
  { ip: "1.1.1.1", host: "cloudflare-dns.com", path: "/dns-query" },
];

const errorCode = (e) => e?.cause?.code || e?.code || null;

/**
 * One HTTPS request to a literal address, presenting `hostname` for SNI and
 * verifying the certificate against it. Resolves to a fetch-like object so
 * callers can treat both paths identically.
 */
function requestByAddress({ address, hostname, port, path, method, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: address,
        servername: hostname, // SNI *and* the name the certificate must match
        port: port || 443,
        path,
        method: method || "GET",
        // The origin server routes on Host, which no longer matches `host`.
        headers: { ...(headers || {}), host: hostname },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => text,
            json: async () => JSON.parse(text),
          });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** A-records for `hostname`, asked of each DoH provider in turn. */
async function resolveOverHttps(hostname, timeoutMs = 5000) {
  for (const p of DOH_PROVIDERS) {
    try {
      const res = await requestByAddress({
        address: p.ip,
        hostname: p.host,
        path: `${p.path}?name=${encodeURIComponent(hostname)}&type=A`,
        headers: { accept: "application/dns-json" },
        timeoutMs,
      });
      if (!res.ok) continue;
      const data = await res.json();
      // type 1 is an A record; CNAMEs in the chain come back as type 5.
      const addresses = (data.Answer || [])
        .filter((a) => a.type === 1 && a.data)
        .map((a) => a.data);
      if (addresses.length) return addresses;
    } catch {
      // Try the next provider. Both being unreachable is reported by the caller.
    }
  }
  return [];
}

/**
 * fetch(), falling back to self-resolved DNS when the platform resolver fails.
 *
 * The normal path runs first and unchanged, so the healthy case pays nothing.
 * Only a DNS-class failure triggers the fallback.
 */
export async function fetchResilient(url, options = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal, cache: "no-store" });
  } catch (e) {
    if (!DNS_ERRORS.has(errorCode(e))) throw e;

    const u = new URL(url);
    const addresses = await resolveOverHttps(u.hostname);
    if (!addresses.length) throw e; // Surface the original, more meaningful error.

    let lastError = e;
    for (const address of addresses) {
      try {
        return await requestByAddress({
          address,
          hostname: u.hostname,
          port: u.port || 443,
          path: `${u.pathname}${u.search}`,
          method: options.method,
          headers: options.headers,
          body: options.body,
          timeoutMs,
        });
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  } finally {
    clearTimeout(timer);
  }
}

export const __testing = { resolveOverHttps, DNS_ERRORS, errorCode };
