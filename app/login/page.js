"use client";
import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";

const PIN_LEN = 6;

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [digits,   setDigits]   = useState(Array(PIN_LEN).fill(""));
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [lockedFor, setLockedFor] = useState(0);
  const inputs = useRef([]);

  useEffect(() => { inputs.current[0]?.focus(); }, []);

  // Lockout countdown
  useEffect(() => {
    if (lockedFor <= 0) return;
    const id = setInterval(() => setLockedFor((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [lockedFor]);

  const submit = useCallback(async (pin) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, next }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        // Full navigation so middleware runs and chains into Upstox if needed.
        window.location.href = data.next || "/";
        return;
      }
      if (res.status === 429) setLockedFor(data.retryAfter || 30);
      setError(data.error || "Incorrect PIN");
      setDigits(Array(PIN_LEN).fill(""));
      inputs.current[0]?.focus();
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }, [next]);

  const setAt = (i, val) => {
    const next = [...digits];
    next[i] = val;
    setDigits(next);
    return next;
  };

  const onChange = (i, e) => {
    const v = e.target.value.replace(/\D/g, "");
    if (!v) { setAt(i, ""); return; }
    // Take the last typed digit; advance.
    const filled = setAt(i, v.slice(-1));
    if (i < PIN_LEN - 1) inputs.current[i + 1]?.focus();
    if (filled.every((d) => d !== "")) submit(filled.join(""));
  };

  const onKeyDown = (i, e) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
      setAt(i - 1, "");
    } else if (e.key === "ArrowLeft" && i > 0) inputs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < PIN_LEN - 1) inputs.current[i + 1]?.focus();
  };

  const onPaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, PIN_LEN);
    if (!text) return;
    const next = Array(PIN_LEN).fill("").map((_, i) => text[i] || "");
    setDigits(next);
    const lastIdx = Math.min(text.length, PIN_LEN) - 1;
    inputs.current[lastIdx]?.focus();
    if (text.length === PIN_LEN) submit(text);
  };

  const disabled = loading || lockedFor > 0;

  return (
    <div className="w-full max-w-sm">
      <div className="bg-card border border-border rounded-2xl p-8 shadow-xl">
        <div className="flex flex-col items-center text-center mb-7">
          <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-4">
            <Lock size={20} className="text-accent" />
          </div>
          <div className="font-display text-2xl font-bold text-text">
            NSE<span className="text-accent">Rank</span>
          </div>
          <div className="font-mono text-[11px] text-dim mt-1.5">Enter your 6-digit PIN to continue</div>
        </div>

        <div className="flex justify-center gap-2 mb-5" onPaste={onPaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => (inputs.current[i] = el)}
              value={d}
              onChange={(e) => onChange(i, e)}
              onKeyDown={(e) => onKeyDown(i, e)}
              disabled={disabled}
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              aria-label={`PIN digit ${i + 1}`}
              className={`w-11 h-14 text-center font-mono text-xl rounded-lg bg-bg border text-text
                focus:outline-none focus:ring-2 focus:ring-accent/40 transition-colors disabled:opacity-50
                ${error ? "border-red/50" : "border-border focus:border-accent"}`}
            />
          ))}
        </div>

        <div className="h-6 text-center">
          {loading && <span className="font-mono text-[11px] text-dim">Checking…</span>}
          {!loading && lockedFor > 0 && (
            <span className="font-mono text-[11px] text-red">Locked — try again in {lockedFor}s</span>
          )}
          {!loading && lockedFor === 0 && error && (
            <span className="font-mono text-[11px] text-red">{error}</span>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-border text-center">
          <div className="font-mono text-[10px] text-muted leading-relaxed">
            Signing in also connects Upstox for live prices.
          </div>
        </div>
      </div>
      <div className="text-center mt-5 font-mono text-[10px] text-muted">
        F&O Seasonality Dashboard · secured
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <Suspense fallback={<div className="font-mono text-sm text-dim">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
