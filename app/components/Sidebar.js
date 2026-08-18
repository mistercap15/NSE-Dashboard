"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Sun, Moon, Menu, X, ChevronDown, LogOut,
  LayoutDashboard, TrendingUp, CalendarDays, SlidersHorizontal, Search, RotateCcw, Zap, LineChart, TrendingDown, Scale, Layers, Target, Bot } from "lucide-react";
import { MONTHS } from "../lib/api";
import { getCurrentMonth, getCurrentYear } from "../lib/date";

// Standalone top link (no group).
const homeItem = { href: "/", label: "Overview", Icon: LayoutDashboard };

// Collapsible nav groups. Each group expands to reveal its pages.
const navGroups = [
  {
    label: "Seasonality",
    Icon: TrendingUp,
    children: [
      { href: "/rankings",        label: "Rankings",        Icon: TrendingUp },
      { href: "/sector-rotation", label: "Sector Rotation", Icon: RotateCcw },
      { href: "/calendar",        label: "Calendar",        Icon: CalendarDays },
      { href: "/backtest",        label: "Backtest",        Icon: LineChart },
    ],
  },
  {
    label: "Trade Setups",
    Icon: Zap,
    children: [
      { href: "/playbook",    label: "Playbook",    Icon: Target },
      { href: "/early-entry", label: "Early Entry", Icon: Zap },
      { href: "/swing-low",   label: "Swing Low",   Icon: TrendingDown },
      { href: "/sizing",      label: "Capital",     Icon: Scale },
      { href: "/fib",         label: "Fib Bot",     Icon: Bot },
    ],
  },
  {
    label: "Research",
    Icon: Layers,
    children: [
      { href: "/analysis", label: "Stock Analysis", Icon: Search },
      { href: "/screener", label: "Screener",       Icon: SlidersHorizontal },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const currentMonth = getCurrentMonth();
  const currentYear = getCurrentYear();
  const [mounted,     setMounted]     = useState(false);
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [openGroups,  setOpenGroups]  = useState({});

  useEffect(() => setMounted(true), []);

  // Close drawer on navigation
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Auto-expand whichever group holds the active route.
  useEffect(() => {
    const g = navGroups.find((grp) => grp.children.some((c) => c.href === pathname));
    if (g) setOpenGroups((prev) => ({ ...prev, [g.label]: true }));
  }, [pathname]);

  const toggleGroup = (label) => setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
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
              {MONTHS[currentMonth - 1]} {currentYear}
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {/* Overview — standalone */}
          {(() => {
            const active = pathname === homeItem.href;
            const { Icon } = homeItem;
            return (
              <Link
                href={homeItem.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-150 ${
                  active
                    ? "bg-accent/10 text-accent border border-accent/20"
                    : "text-dim hover:text-text hover:bg-white/[0.03]"
                }`}
              >
                <Icon size={15} />
                <span className="font-body">{homeItem.label}</span>
                {active && <div className="ml-auto w-1 h-1 rounded-full bg-accent" />}
              </Link>
            );
          })()}

          {/* Collapsible groups */}
          {navGroups.map(({ label, Icon: GroupIcon, children }) => {
            const open = !!openGroups[label];
            const hasActive = children.some((c) => c.href === pathname);
            return (
              <div key={label} className="pt-1">
                <button
                  onClick={() => toggleGroup(label)}
                  aria-expanded={open}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-150 ${
                    hasActive ? "text-accent" : "text-soft hover:text-text hover:bg-white/[0.03]"
                  }`}
                >
                  <GroupIcon size={15} />
                  <span className="font-body font-medium">{label}</span>
                  {hasActive && !open && <div className="w-1 h-1 rounded-full bg-accent" />}
                  <ChevronDown
                    size={14}
                    className={`ml-auto transition-transform duration-200 ${hasActive ? "text-accent" : "text-dim"} ${open ? "rotate-180" : ""}`}
                  />
                </button>

                {open && (
                  <div className="mt-1 ml-3 pl-3 border-l border-border space-y-0.5 animate-fade-in">
                    {children.map(({ href, label: childLabel, Icon }) => {
                      const active = pathname === href;
                      return (
                        <Link
                          key={href}
                          href={href}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-all duration-150 ${
                            active
                              ? "bg-accent/10 text-accent border border-accent/20"
                              : "text-dim hover:text-text hover:bg-white/[0.03]"
                          }`}
                        >
                          <Icon size={14} />
                          <span className="font-body">{childLabel}</span>
                          {active && <div className="ml-auto w-1 h-1 rounded-full bg-accent" />}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
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

        {/* Bottom info + logout */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-2">
          <div className="text-[10px] font-mono text-muted">
            205 F&O stocks<br />
            <span className="text-dim">Real NSE data</span>
          </div>
          <a
            href="/api/auth/logout"
            className="flex items-center gap-1.5 font-mono text-[10px] text-dim hover:text-red hover:bg-red/5 px-2 py-1.5 rounded transition-colors"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut size={13} />
            Logout
          </a>
        </div>
      </aside>
    </>
  );
}
