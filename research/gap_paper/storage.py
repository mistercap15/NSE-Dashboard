"""Local SQLite account snapshots; BEGIN IMMEDIATE serializes observer and controls."""

import json, sqlite3, uuid
from pathlib import Path
from .engine import fresh, process, digest


def connect(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path, timeout=30)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute(
        "CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,state TEXT,active INTEGER)"
    )
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


def update(path, cfg, manifest, calendar, events=None, action=None):
    c = connect(path)
    try:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT id,state FROM accounts WHERE active=1").fetchone()
        if action == "reset" or not row:
            c.execute("UPDATE accounts SET active=0 WHERE active=1")
            aid = str(uuid.uuid4())
            s = fresh(cfg, manifest, calendar)
            c.execute("INSERT INTO accounts VALUES(?,?,1)", (aid, json.dumps(s)))
        else:
            aid = row[0]
            s = json.loads(row[1])
        if s["hash"] != digest([cfg, manifest, calendar]):
            raise ValueError("Configuration or reference data changed; reset account")
        if action == "pause":
            s["paused"] = True
        if action == "resume":
            s["paused"] = False
        for event in events or []:
            process(s, event, cfg, manifest, calendar)
        c.execute("UPDATE accounts SET state=? WHERE id=?", (json.dumps(s), aid))
        c.commit()
        return {"account_id": aid, **s}
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()
