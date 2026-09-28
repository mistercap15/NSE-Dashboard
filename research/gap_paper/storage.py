"""Transactional paper snapshots, event journal and reconciled daily ledgers."""

import json, sqlite3, uuid
from pathlib import Path
from .engine import fresh, process, digest, equity, total

ARRAYS = [
    "trades",
    "signals",
    "rejections",
    "cashflows",
    "equity_curve",
    "events",
    "daily_scans",
]


def connect(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path, timeout=30)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute(
        "CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,state TEXT,active INTEGER)"
    )
    c.execute(
        "CREATE TABLE IF NOT EXISTS journal(account_id TEXT,at TEXT,hash TEXT,payload TEXT,PRIMARY KEY(account_id,at))"
    )
    c.execute(
        "CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY,account_id TEXT,kind TEXT,day TEXT,payload TEXT)"
    )
    c.execute("CREATE INDEX IF NOT EXISTS records_day ON records(account_id,day,kind)")
    c.execute(
        "CREATE TABLE IF NOT EXISTS days(account_id TEXT,day TEXT,payload TEXT,PRIMARY KEY(account_id,day))"
    )
    c.execute("CREATE TABLE IF NOT EXISTS runtime(key TEXT PRIMARY KEY,value TEXT)")
    return c


def read(path):
    if not Path(path).exists():
        return None
    c = connect(path)
    try:
        row = c.execute("SELECT id,state FROM accounts WHERE active=1").fetchone()
        return {"account_id": row[0], **json.loads(row[1])} if row else None
    finally:
        c.close()


def unrealized(s):
    return sum(
        (p["mark"] - p["entry"]) * p["qty"] - total(p["entry_costs"])
        for p in s["positions"].values()
    )


def metadata(path, key, value=None):
    c = connect(path)
    try:
        if value is not None:
            c.execute(
                "INSERT OR REPLACE INTO runtime VALUES(?,?)", (key, json.dumps(value))
            )
            c.commit()
            return value
        row = c.execute("SELECT value FROM runtime WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None
    finally:
        c.close()


def update(
    path,
    cfg,
    manifest,
    calendar,
    events=None,
    action=None,
    operational_halt=None,
    refresh_references=False,
):
    c = connect(path)
    try:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT id,state FROM accounts WHERE active=1").fetchone()
        if action == "reset" or not row:
            c.execute("UPDATE accounts SET active=0 WHERE active=1")
            aid = str(uuid.uuid4())
            s = fresh(cfg, manifest, calendar)
            s["strategy_hash"] = digest(cfg)
            c.execute("INSERT INTO accounts VALUES(?,?,1)", (aid, json.dumps(s)))
        else:
            aid = row[0]
            s = json.loads(row[1])
        if s["hash"] != digest([cfg, manifest, calendar]):
            if (
                not refresh_references
                or s.get("strategy_hash") != digest(cfg)
                or s["positions"]
            ):
                raise ValueError(
                    "Configuration or reference data changed; explicit safe reference refresh or reset required"
                )
            s["hash"] = digest([cfg, manifest, calendar])
        if refresh_references:
            c.execute(
                "INSERT INTO records(account_id,kind,day,payload) VALUES(?,?,?,?)",
                (
                    aid,
                    "references",
                    s.get("session"),
                    json.dumps(
                        {"config": cfg, "manifest": manifest, "calendar": calendar}
                    ),
                ),
            )
        if action == "pause":
            s["paused"] = True
        if action == "resume":
            s["paused"] = False
        if operational_halt is not None:
            s["operational_halt"] = operational_halt
        for event in events or []:
            seen = c.execute(
                "SELECT hash FROM journal WHERE account_id=? AND at=?",
                (aid, event["at"]),
            ).fetchone()
            if seen:
                if seen[0] != digest(event):
                    raise ValueError("Conflicting duplicate event")
                continue
            before = {k: len(s[k]) for k in ARRAYS}
            opening = equity(s)
            opening_u = unrealized(s)
            process(s, event, cfg, manifest, calendar)
            day = event["at"][:10]
            c.execute(
                "INSERT INTO journal VALUES(?,?,?,?)",
                (aid, event["at"], digest(event), json.dumps(event)),
            )
            for kind in ARRAYS:
                for record in s[kind][before[kind] :]:
                    if not event.get("bootstrap") and (
                        kind != "equity_curve"
                        or event.get("kind") not in ("quote", "quotes")
                    ):
                        c.execute(
                            "INSERT INTO records(account_id,kind,day,payload) VALUES(?,?,?,?)",
                            (aid, kind, day, json.dumps(record)),
                        )
            if not event.get("bootstrap"):
                old = c.execute(
                    "SELECT payload FROM days WHERE account_id=? AND day=?", (aid, day)
                ).fetchone()
                d = (
                    json.loads(old[0])
                    if old
                    else {
                        "day": day,
                        "opening_equity": opening,
                        "opening_unrealized": opening_u,
                        "realized_pnl": 0,
                        "fees": 0,
                        "entries": 0,
                        "closed_trades": 0,
                        "peak_equity": opening,
                        "max_drawdown": 0,
                    }
                )
                trades = s["trades"][before["trades"] :]
                flows = s["cashflows"][before["cashflows"] :]
                d["realized_pnl"] += sum(t["pnl"] for t in trades)
                d["fees"] += sum(total(f["fees"]) for f in flows)
                d["entries"] += sum(f["kind"] == "entry" for f in flows)
                d["closed_trades"] += len(trades)
                d["equity"] = equity(s)
                d["cash"] = s["cash"]
                d["open_unrealized_pnl"] = unrealized(s)
                d["unrealized_change"] = unrealized(s) - d["opening_unrealized"]
                d["net_pnl"] = equity(s) - d["opening_equity"]
                d["return_fraction"] = (
                    d["net_pnl"] / d["opening_equity"] if d["opening_equity"] else 0
                )
                d["peak_equity"] = max(d["peak_equity"], equity(s))
                d["max_drawdown"] = max(d["max_drawdown"], d["peak_equity"] - equity(s))
                d["last_event"] = event["at"]
                d["open_positions"] = len(s["positions"])
                if (
                    abs(d["realized_pnl"] + d["unrealized_change"] - d["net_pnl"])
                    > 0.01
                ):
                    raise ValueError("Daily P&L reconciliation failed")
                c.execute(
                    "INSERT OR REPLACE INTO days VALUES(?,?,?)",
                    (aid, day, json.dumps(d)),
                )
            if event.get("bootstrap"):
                for kind in ARRAYS:
                    s[kind] = []
        # Detailed history remains in the append-only journal/records, not a growing hot snapshot.
        for kind in ARRAYS:
            s[kind] = s[kind][-500:]
        c.execute("UPDATE accounts SET state=? WHERE id=?", (json.dumps(s), aid))
        c.commit()
        return {"account_id": aid, **s}
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def dashboard(path, day=None):
    from .cli import trimmed

    s = read(path)
    result = trimmed(s)
    result["service"] = metadata(path, "health") or {"status": "not_running"}
    result["universe"] = metadata(path, "universe") or {}
    if not s:
        return result
    c = connect(path)
    try:
        aid = s["account_id"]
        days = [
            json.loads(r[0])
            for r in c.execute(
                "SELECT payload FROM days WHERE account_id=? ORDER BY day DESC", (aid,)
            )
        ]
        selected = day or (days[0]["day"] if days else s["session"])
        result["daily_history"] = days
        result["selected_day"] = selected
        result["daily"] = next((d for d in days if d["day"] == selected), None)
        result["day_records"] = {
            kind: [
                json.loads(r[0])
                for r in c.execute(
                    "SELECT payload FROM records WHERE account_id=? AND day=? AND kind=? ORDER BY id",
                    (aid, selected, kind),
                )
            ]
            for kind in [
                "trades",
                "signals",
                "rejections",
                "cashflows",
                "events",
                "equity_curve",
            ]
        }
        return result
    finally:
        c.close()
