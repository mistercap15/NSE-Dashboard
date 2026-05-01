const year = new Date().getFullYear();

export default function Footer() {
  return (
    <footer className="fixed bottom-0 left-0 md:left-[200px] right-0 z-40 border-t border-border bg-bg px-4 md:px-8 py-3 flex items-center justify-between gap-4">
      <div className="font-mono text-[10px] text-muted">
        NSE via GOOGLEFINANCE · 2009–{year} · Not SEBI-registered advice · Trade at your own risk
      </div>
      <span className="font-body text-[11px] text-muted">
        Crafted by <span className="text-accent font-medium">Khilan Patel</span>
      </span>
    </footer>
  );
}
