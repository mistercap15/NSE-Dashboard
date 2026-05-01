export default function StatCard({ label, value, sub, color = "text-text", mono = true }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 card-hover">
      <div className="font-mono text-[10px] text-dim uppercase tracking-widest mb-2">{label}</div>
      <div className={`text-xl font-medium ${color} ${mono ? "font-mono" : "font-display"}`}>
        {value}
      </div>
      {sub && <div className="font-mono text-[11px] text-muted mt-1">{sub}</div>}
    </div>
  );
}
