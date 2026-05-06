"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Sun, Moon, Menu, X,
  LayoutDashboard, TrendingUp, CalendarDays, Wallet, SlidersHorizontal, Search, RotateCcw, Zap,
} from "lucide-react";
import { MONTHS } from "../lib/api";

const currentMonth = new Date().getMonth() + 1;

const navItems = [
  { href: "/",          label: "Overview",       Icon: LayoutDashboard },
  { href: "/rankings",  label: "Rankings",       Icon: TrendingUp },
  { href: "/analysis",  label: "Stock Analysis", Icon: Search },
  { href: "/calendar",        label: "Calendar",       Icon: CalendarDays },
  { href: "/sector-rotation", label: "Sector Rotation", Icon: RotateCcw },
  { href: "/early-entry",     label: "Early Entry",    Icon: Zap },
  { href: "/portfolio",       label: "Portfolio",      Icon: Wallet },
  { href: "/screener",  label: "Screener",       Icon: SlidersHorizontal },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted,     setMounted]     = useState(false);
  const [mobileOpen,  setMobileOpen]  = useState(false);

  useEffect(() => setMounted(true), []);

  // Close drawer on navigation
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <>
      {/* ── Mobile top bar (hidden on md+) ───────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 h-14 bg-surface border-b border-border flex items-center justify-between px-4">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-1.5 rounded text-dim hover:text-text transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="font-display text-base font-bold text-accent tracking-tight">
          NSE<span className="text-text">Rank</span>
        </div>
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded text-dim hover:text-text transition-colors"
          aria-label="Toggle theme"
        >
          {mounted && (theme === "dark" ? <Sun size={14} /> : <Moon size={14} />)}
        </button>
      </div>

      {/* ── Backdrop (mobile only) ────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className={`
        fixed left-0 top-0 h-screen w-[200px] bg-surface border-r border-border flex flex-col z-50
        transition-transform duration-200 ease-in-out
        ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        md:translate-x-0
      `}>
        {/* Mobile close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden absolute top-3 right-3 p-1.5 rounded text-dim hover:text-text transition-colors"
          aria-label="Close menu"
        >
          <X size={16} />
        </button>

        {/* Logo + theme toggle (desktop only for toggle) */}
        <div className="px-5 py-5 border-b border-border flex items-start justify-between">
          <div>
            <div className="font-display text-lg font-bold text-accent tracking-tight leading-none">
              NSE<span className="text-text">Rank</span>
            </div>
            <div className="font-mono text-[10px] text-dim mt-1 tracking-widest uppercase">
              F&O Seasonality
            </div>
          </div>
          {/* Theme toggle — visible on desktop sidebar, hidden on mobile (top bar has it) */}
          <button
            onClick={toggleTheme}
            className="hidden md:block mt-0.5 p-1.5 rounded text-dim hover:text-text hover:bg-white/[0.06] transition-colors"
            aria-label="Toggle theme"
          >
            {mounted && (theme === "dark" ? <Sun size={14} /> : <Moon size={14} />)}
          </button>
        </div>

        {/* Month indicator */}
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-1">Current</div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
            <span className="font-mono text-xs text-green font-medium">
              {MONTHS[currentMonth - 1]} {new Date().getFullYear()}
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map(({ href, label, Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-150 ${
                  active
                    ? "bg-accent/10 text-accent border border-accent/20"
                    : "text-dim hover:text-text hover:bg-white/[0.03]"
                }`}
              >
                <Icon size={15} />
                <span className="font-body">{label}</span>
                {active && <div className="ml-auto w-1 h-1 rounded-full bg-accent" />}
              </Link>
            );
          })}
        </nav>

        {/* Quick month links */}
        <div className="px-4 pb-2 border-t border-border pt-3">
          <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-2">Quick jump</div>
          <div className="grid grid-cols-4 gap-1">
            {MONTHS.map((m, i) => (
              <Link
                key={m}
                href={`/rankings?month=${i + 1}`}
                className={`font-mono text-[10px] text-center py-1 rounded transition-colors ${
                  i + 1 === currentMonth
                    ? "bg-accent/20 text-accent"
                    : "text-dim hover:text-soft hover:bg-white/[0.05]"
                }`}
              >
                {m}
              </Link>
            ))}
          </div>
        </div>

        {/* Bottom info */}
        <div className="px-4 py-3 border-t border-border">
          <div className="text-[10px] font-mono text-muted">
            205 F&O stocks<br />
            <span className="text-dim">Real NSE data</span>
          </div>
        </div>
      </aside>
    </>
  );
}
