// Unit checks for the DNS-over-HTTPS fetch fallback. Run: npm run test:dns
//
// Same .mjs copy trick as the other test scripts: the libs are ESM but
// package.json has no "type": "module", so bare node would parse them as
// CommonJS.
//
// What this guards. The bot-sync button failed with ENOTFOUND on a hostname that
// four public resolvers answered 20/20 — Vercel's Lambda resolver could not
// resolve the Funnel's `ts.net` zone and negative-cached the miss. The fallback
// resolves such names itself, over DoH providers addressed by literal IP.
//
// The security-shaped assertions matter most here: this file connects to a raw
// address, so the certificate must still be checked against the original
// hostname, and non-DNS failures must never be retried into.
import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "app", "lib", "dnsFallback.js");
const dest = join(here, ".dnsFallback.tmp.mjs");
cpSync(src, dest);
process.on("exit", () => { try { rmSync(dest); } catch {} });

const { fetchResilient, __testing } = await import(dest);
const { resolveOverHttps, DNS_ERRORS, errorCode } = __testing;

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const dnsError = (code) => {
  const e = new TypeError("fetch failed");
  e.cause = Object.assign(new Error(`getaddrinfo ${code}`), { code });
  return e;
};

// ── error classification ────────────────────────────────────────────────────
ok("reads the code out of a wrapped undici cause", errorCode(dnsError("ENOTFOUND")) === "ENOTFOUND");
ok("reads a top-level code", errorCode(Object.assign(new Error("x"), { code: "ECONNREFUSED" })) === "ECONNREFUSED");
ok("a codeless error classifies as null", errorCode(new Error("boom")) === null);

ok("ENOTFOUND is treated as a DNS failure", DNS_ERRORS.has("ENOTFOUND"));
ok("EAI_AGAIN is treated as a DNS failure", DNS_ERRORS.has("EAI_AGAIN"));
ok("ECONNREFUSED is NOT a DNS failure", !DNS_ERRORS.has("ECONNREFUSED"));
ok("a TLS failure is NOT a DNS failure", !DNS_ERRORS.has("CERT_HAS_EXPIRED"));

// ── the fallback must be a last resort, never a first move ──────────────────
{
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, status: 200 }; };
  const res = await fetchResilient("https://example.invalid/x", {}, 2000);
  globalThis.fetch = real;
  ok("a healthy fetch is returned untouched", res.status === 200);
  ok("the healthy path calls platform fetch exactly once", calls === 1);
}

// A non-DNS error must surface as itself. Retrying a refused connection or a bad
// certificate by address would turn a clear failure into a confusing one.
{
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" }); };
  let surfaced = null;
  try { await fetchResilient("https://example.invalid/x", {}, 2000); }
  catch (e) { surfaced = errorCode(e); }
  globalThis.fetch = real;
  ok("a refused connection is surfaced, not retried by address", surfaced === "ECONNREFUSED");
}

// ── the file must never disable certificate verification ────────────────────
{
  // Strip comments first. The source *discusses* rejectUnauthorized in its
  // header note explaining why it must never appear; scanning raw text would
  // match that prose and fail on the very comment warning against it.
  const text = readFileSync(src, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  ok("never sets rejectUnauthorized", !/rejectUnauthorized/.test(text));
  ok("never disables Node's TLS check", !/NODE_TLS_REJECT_UNAUTHORIZED/.test(text));
  ok("passes servername so the certificate is bound to the real hostname",
     /servername:\s*hostname/.test(text));
  ok("overrides the Host header for origin routing", /host:\s*hostname/.test(text));
}

// ── live checks; skipped without network so the suite stays runnable offline ─
let online = true;
try { await fetch("https://dns.google/resolve?name=example.com&type=A"); }
catch { online = false; }

if (!online) {
  console.log("  skip live DoH checks (no network)");
} else {
  const addrs = await resolveOverHttps("example.com");
  ok("DoH returns A records for a known name", addrs.length > 0, `got ${JSON.stringify(addrs)}`);
  ok("DoH returns dotted-quad addresses", addrs.every((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)));

  const none = await resolveOverHttps("this-name-does-not-exist.invalid");
  ok("an unresolvable name yields no addresses", none.length === 0);

  // The real scenario: platform DNS is broken, the name is fine.
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw dnsError("ENOTFOUND"); };
  let status = null;
  try {
    const r = await fetchResilient("https://example.com/", {}, 10000);
    status = r.status;
  } catch { /* reported below */ }
  globalThis.fetch = real;
  ok("reaches a host over DoH when the platform resolver fails", status !== null,
     "fallback did not complete");

  // When the name is genuinely bad, the original error must win — a misleading
  // "no addresses" error would send someone hunting the wrong problem.
  const real2 = globalThis.fetch;
  globalThis.fetch = async () => { throw dnsError("ENOTFOUND"); };
  let code = null;
  try { await fetchResilient("https://this-name-does-not-exist.invalid/", {}, 8000); }
  catch (e) { code = errorCode(e); }
  globalThis.fetch = real2;
  ok("a genuinely dead name surfaces the original DNS error", code === "ENOTFOUND");
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
