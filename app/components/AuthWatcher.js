"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Bounces to /login when the session lapses or Upstox expires while a page is
// open. Middleware already gates navigations; this catches the idle-tab case.
export default function AuthWatcher() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/login") return;
    let stopped = false;

    const check = async () => {
      try {
        const res = await fetch("/api/upstox/status", { cache: "no-store" });
        // 401 → PIN session gone; expired → Upstox token dead. Either way, re-login.
        if (res.status === 401) { if (!stopped) window.location.href = "/login"; return; }
        const data = await res.json().catch(() => ({}));
        if (data?.expired && !stopped) window.location.href = "/login";
      } catch { /* offline — ignore */ }
    };

    const id = setInterval(check, 120000); // every 2 min
    return () => { stopped = true; clearInterval(id); };
  }, [pathname]);

  return null;
}
