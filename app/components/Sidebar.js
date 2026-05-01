"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Sun, Moon,
  LayoutDashboard, TrendingUp, CalendarDays, Wallet, SlidersHorizontal, Search,
} from "lucide-react";
import { MONTHS } from "../lib/api";

const currentMonth = new Date().getMonth() + 1;

const navItems = [
  { href: "/",          label: "Overview",       Icon: LayoutDashboard },
  { href: "/rankings",  label: "Rankings",       Icon: TrendingUp },
  { href: "/analysis",  label: "Stock Analysis", Icon: Search },
  { href: "/calendar",  label: "Calendar",       Icon: CalendarDays },
  { href: "/portfolio", label: "Portfolio",      Icon: Wallet },
  { href: "/screener",  label: "Screener",       Icon: SlidersHorizontal },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <aside className="fixed left-0 top-0 h-screen w-[200px] bg-surface border-r border-border flex flex-col z-50">

      {/* Logo + theme toggle */}
      <div className="px-5 py-5 border-b border-border flex items-start justify-between">
        <div>
          <div className="font-display text-lg font-bold text-accent tracking-tight leading-none">
            NSE<span className="text-text">Rank</span>
          </div>
          <div className="font-mono text-[10px] text-dim mt-1 tracking-widest uppercase">
            F&O Seasonality
          </div>
        </div>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="mt-0.5 p-1.5 rounded text-dim hover:text-text hover:bg-white/[0.06] transition-colors"
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
  );
}
