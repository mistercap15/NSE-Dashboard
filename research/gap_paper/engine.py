"""Pure deterministic paper engine. No network, broker clients or filesystem effects."""

import copy, hashlib, json, math, statistics
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

IST = timezone(timedelta(hours=5, minutes=30))


def digest(x):
    return hashlib.sha256(
        json.dumps(x, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def stamp(ts):
    t = datetime.fromisoformat(ts)
    if t.tzinfo is None:
        raise ValueError("Timezone required")
    return t.astimezone(IST)


def minute(ts):
    t = stamp(ts)
    return t.hour * 60 + t.minute


def normalize(symbol, row):
    t = stamp(row[0])
    o, h, l, c, v = map(float, row[1:6])
    if t.second or t.microsecond or (t.hour * 60 + t.minute - 555) % 5:
        raise ValueError("Misaligned candle")
    if (
        not all(math.isfinite(x) for x in (o, h, l, c, v))
        or min(o, h, l, c) <= 0
        or l > min(o, c)
        or h < max(o, c)
        or l > h
        or v < 0
        or not v.is_integer()
    ):
        raise ValueError("Invalid OHLCV")
    return {
        "symbol": symbol,
        "ts": t.isoformat(),
        "o": o,
        "h": h,
        "l": l,
        "c": c,
        "v": v,
    }


def fresh(config, manifest, calendar):
    return {
        "version": config["version"],
        "hash": digest([config, manifest, calendar]),
        "cash": config["initial_capital"],
        "equity": config["initial_capital"],
        "peak": config["initial_capital"],
        "drawdown": 0,
        "max_drawdown_fraction": 0,
        "session": None,
        "day_start": config["initial_capital"],
        "day_entries": 0,
        "halted": False,
        "paused": False,
        "last_event": None,
        "last_hash": None,
        "shortlist": [],
        "ranked": False,
        "stocks": {},
        "positions": {},
        "trades": [],
        "signals": [],
        "rejections": [],
        "cashflows": [],
        "equity_curve": [],
        "events": [],
        "coverage": {},
        "daily_scans": [],
        "data_status": "waiting",
        "execution": config["execution"],
    }


def costs(price, qty, side, cfg, day=None, overnight=False):
    f = cfg["fees"]
    for schedule in sorted(cfg.get("dated_fees", []), key=lambda x: x["from"]):
        if day and schedule["from"] <= day:
            f = schedule["fees"]
    n = price * qty
    b = min(f["brokerage_cap"], n * f["brokerage_rate"])
    ex = n * f["exchange_rate"]
    se = n * f["sebi_rate"]
    ip = n * f["ipft_rate"]
    vals = {
        "brokerage": b,
        "exchange": ex,
        "sebi": se,
        "ipft": ip,
        "gst": (b + ex + se + ip) * f["gst_rate"],
        "stamp": n * f["stamp_buy_rate"] if side == "buy" else 0,
        "stt": (
            n * (0.001 if overnight else f["stt_sell_rate"]) if side == "sell" else 0
        ),
    }
    return {
        k: float(
            Decimal(str(v * cfg["cost_multiplier"])).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
        )
        for k, v in vals.items()
    }


def total(c):
    return sum(c.values())


def tick_up(x, t):
    return round(math.ceil((x - 1e-9) / t) * t, 8)


def tick_down(x, t):
    return round(math.floor((x + 1e-9) / t) * t, 8)


def equity(s):
    return s["cash"] + sum(p["qty"] * p["mark"] for p in s["positions"].values())


def mark(s, at, cfg):
    s["equity"] = equity(s)
    s["peak"] = max(s["peak"], s["equity"])
    s["drawdown"] = max(s["drawdown"], s["peak"] - s["equity"])
    s["max_drawdown_fraction"] = max(
        s.get("max_drawdown_fraction", 0), (s["peak"] - s["equity"]) / s["peak"]
    )
    if s["equity"] <= s["day_start"] * (1 - cfg["daily_loss_fraction"]):
        s["halted"] = True
    return s["equity"]


def reject(s, sym, at, reason):
    s["rejections"].append({"symbol": sym, "at": at, "reason": reason})


def invalidate(x, reason):
    x["phase"] = "invalid"
    x["reason"] = reason
    x["pending"] = None


def member(manifest, sym, day):
    rows = [
        r
        for r in manifest.get("members", [])
        if r["symbol"] == sym and r.get("from", "0000") <= day <= r.get("to", "9999")
    ]
    if len(rows) != 1:
        return None
    r = rows[0]
    if (
        r.get("segment") != "NSE_EQ"
        or r.get("ordinary_share") is not True
        or r.get("eligible") is not True
        or r.get("suspended") is not False
        or not r.get("tick_size", 0) > 0
    ):
        return None
    return r


def start_day(s, day, cal):
    if s["session"]:
        s["daily_scans"].append(
            {
                "day": s["session"],
                "shortlist": copy.deepcopy(s["shortlist"]),
                "states": {
                    sym: {
                        k: x.get(k)
                        for k in ["phase", "reason", "gap", "median_value", "count"]
                    }
                    for sym, x in s["stocks"].items()
                },
            }
        )
        for x in s["stocks"].values():
            if cal.get(s["session"]) == "regular" and x.get("minutes") == list(
                range(555, 930, 5)
            ):
                x["values"] = (x["values"] + [x["pv"]])[-20:]
                x["prior_close"] = x["prev_close"]
                x["prior_day"] = s["session"]
            else:
                x["values"] = []
                x["ema"] = None
                x["count"] = 0
                x["prior_close"] = None
    s["session"] = day
    s["day_start"] = equity(s)
    s["day_entries"] = 0
    s["halted"] = False
    s["ranked"] = False
    s["shortlist"] = []
    for x in s["stocks"].values():
        x.update(
            phase="waiting",
            reason="",
            pending=None,
            minutes=[],
            pv=0,
            vol=0,
            vwap=None,
            opening=None,
            pull_count=0,
            pull_low=None,
            last_minute=None,
            last_volume=0,
            entered=False,
            pending_age=0,
            advance_at=None,
            pull_ended=False,
            prev_close=x.get("prior_close"),
        )


def close_position(s, sym, price, at, reason, cfg, ambiguous=False, delayed=False):
    p = s["positions"].pop(sym)
    overnight = at[:10] != p["entry_at"][:10]
    fee = costs(price, p["qty"], "sell", cfg, at[:10], overnight)
    net = (price - p["entry"]) * p["qty"] - total(p["entry_costs"]) - total(fee)
    s["cash"] += price * p["qty"] - total(fee)
    s["cashflows"].append(
        {
            "at": at,
            "symbol": sym,
            "kind": "exit",
            "amount": price * p["qty"] - total(fee),
            "fees": fee,
        }
    )
    s["trades"].append(
        {
            **p,
            "exit_at": at,
            "exit": price,
            "exit_costs": fee,
            "pnl": net,
            "reason": reason,
            "ambiguous": ambiguous,
            "delayed": delayed or overnight,
            "overnight_cost_assumption": overnight,
        }
    )


def proposal(s, x, fill, cfg, day):
    stop = x["pending"]["stop"]
    risk = fill - stop
    eq = equity(s)
    if risk <= 0:
        return 0, "invalid_risk"
    if s.get("operational_halt"):
        return 0, "data_health_halt"
    if s["paused"]:
        return 0, "paper_paused"
    if s["halted"]:
        return 0, "daily_loss_halt"
    if any(p["entry_at"][:10] != day for p in s["positions"].values()):
        return 0, "delayed_overnight_exit"
    if len(s["positions"]) >= cfg["max_positions"]:
        return 0, "position_limit"
    if s["day_entries"] >= cfg["max_daily_entries"]:
        return 0, "daily_entry_limit"
    used = sum(p["planned_risk"] for p in s["positions"].values())
    budget = min(eq * cfg["risk_fraction"], eq * cfg["aggregate_risk_fraction"] - used)
    q = math.floor(
        min(
            budget / risk,
            eq * cfg["allocation_fraction"] / fill,
            s["cash"] / fill,
            x["last_volume"] * cfg["participation"],
        )
    )
    while q > 0:
        reserve = total(costs(fill, q, "buy", cfg, day)) + total(
            costs(stop, q, "sell", cfg, day)
        )
        if risk * q + reserve <= budget and fill * q + reserve <= min(
            s["cash"], eq * cfg["allocation_fraction"]
        ):
            break
        q -= 1
    return q, None if q else "size_cash_risk_or_participation"


def enter(s, sym, x, fill, at, cfg, details=None):
    q, reason = proposal(s, x, fill, cfg, at[:10])
    if reason:
        reject(s, sym, at, reason)
        invalidate(x, reason)
        return False
    p = x["pending"]
    risk = fill - p["stop"]
    fee = costs(fill, q, "buy", cfg, at[:10])
    s["cash"] -= q * fill + total(fee)
    s["positions"][sym] = {
        "symbol": sym,
        "qty": q,
        "entry": fill,
        "entry_at": at,
        "signal_at": p["created"],
        "signal_observed_at": p.get("observed_at", p["created"]),
        "stop": p["stop"],
        "risk": risk,
        "target": fill + 2 * risk,
        "mark": fill,
        "mark_at": at,
        "entry_costs": fee,
        "planned_risk": risk * q
        + total(fee)
        + total(costs(p["stop"], q, "sell", cfg, at[:10])),
        "rank": x["rank"],
        "execution": cfg["execution"],
        "details": details or {},
        "entry_slippage": fill - p["trigger"],
    }
    s["cashflows"].append(
        {
            "at": at,
            "symbol": sym,
            "kind": "entry",
            "amount": -q * fill - total(fee),
            "fees": fee,
        }
    )
    s["day_entries"] += 1
    x["entered"] = True
    x["phase"] = "entered"
    x["pending"] = None
    return True


def candle_exit(s, sym, b, cfg, entry_inside=False):
    p = s["positions"][sym]
    at = b["ts"]
    m = minute(at)
    slip = cfg["slippage_bps"] / 10000
    stop = p["stop"]
    target = p["target"]
    tick = s["stocks"][sym]["tick"]
    delayed = at[:10] != p["entry_at"][:10] or m > cfg["squareoff"]
    if not entry_inside and (at[:10] != p["entry_at"][:10] or m >= cfg["squareoff"]):
        close_position(
            s, sym, b["o"] * (1 - slip), at, "squareoff", cfg, delayed=delayed
        )
        return
    if not entry_inside and b["o"] <= stop:
        close_position(s, sym, b["o"] * (1 - slip), at, "stop_gap", cfg)
        return
    stop_hit = b["l"] <= stop
    target_hit = b["h"] >= target + tick
    if stop_hit:
        close_position(
            s,
            sym,
            stop * (1 - slip),
            at,
            "stop",
            cfg,
            ambiguous=entry_inside or target_hit,
        )
        return
    if target_hit and not entry_inside:
        close_position(s, sym, target * (1 - slip), at, "target", cfg)


def transition(s, x, b, cfg, day, received_at=None):
    m = minute(b["ts"])
    close_at = (stamp(b["ts"]) + timedelta(minutes=5)).isoformat()
    c = b["c"]
    if x["phase"] == "selected":
        if m + 5 > cfg["advance_cutoff"]:
            invalidate(x, "advance_timeout")
        elif c >= x["opening"] * (1 + cfg["advance"]):
            x["phase"] = "advanced"
            x["advance_at"] = close_at
    elif x["phase"] in ("advanced", "pullback", "armed"):
        if m + 5 >= cfg["entry_cutoff"]:
            invalidate(x, "entry_cutoff")
            return
        lower = x["prev_close"] is not None and c < x["prev_close"]
        if x["phase"] == "advanced":
            if lower:
                x["phase"] = "pullback"
                x["pull_count"] = 1
                x["pull_low"] = b["l"]
        elif lower and not x.get("pull_ended"):
            x["pull_count"] += 1
            x["pull_low"] = min(x["pull_low"], b["l"])
        elif x["phase"] == "pullback":
            invalidate(x, "first_pullback_ended_early")
            return
        else:
            x["pull_ended"] = True
            return
        if x["phase"] in ("pullback", "armed"):
            if x["pull_low"] <= x["opening"]:
                invalidate(x, "pullback_below_open")
                return
            if x["pull_count"] > cfg["pullback_max"]:
                invalidate(x, "sixth_pullback_candle")
                return
            if x["pull_count"] >= cfg["pullback_min"]:
                near = any(
                    v and abs(c / v - 1) <= cfg["proximity"]
                    for v in [x["ema"], x["vwap"]]
                )
                if not near:
                    invalidate(x, "first_pullback_proximity_failed")
                    return
                observed = stamp(received_at or close_at)
                eligible = observed
                if cfg["execution"] == "candle":
                    epoch = observed.timestamp()
                    eligible = datetime.fromtimestamp(math.ceil(epoch / 300) * 300, IST)
                prior = x["pending"]
                x["pending"] = {
                    "trigger": tick_up(b["h"] + x["tick"], x["tick"]),
                    "stop": tick_down(x["pull_low"] - x["tick"], x["tick"]),
                    "created": close_at,
                    "observed_at": observed.isoformat(),
                    "eligible_from": eligible.isoformat(),
                    "original_created": (
                        prior["original_created"] if prior else close_at
                    ),
                }
                x["phase"] = "armed"
                s["signals"].append(
                    {
                        "symbol": b["symbol"],
                        "at": close_at,
                        **x["pending"],
                        "rank": x["rank"],
                    }
                )


def process(s, event, cfg, manifest, cal):
    """Atomic caller required. event is complete timestamp batch, or one quote observation."""
    if s["hash"] != digest([cfg, manifest, cal]):
        raise ValueError("Configuration or reference data changed; reset account")
    at = event["at"]
    if at != stamp(at).isoformat():
        raise ValueError("Event timestamp must be canonical ISO Asia/Kolkata")
    closed_at = event.get("closed_at", at)
    if stamp(closed_at) > stamp(at):
        raise ValueError("Candle closes after receipt")
    if event.get("received_at") and stamp(event["received_at"]) < stamp(closed_at):
        raise ValueError("Observation predates completed candle")
    eh = digest(event)
    if s["last_event"]:
        if at < s["last_event"]:
            raise ValueError("Out-of-order event")
        if at == s["last_event"]:
            if eh != s["last_hash"]:
                raise ValueError("Conflicting duplicate event")
            return s
    day = stamp(at).date().isoformat()
    if day != s["session"]:
        start_day(s, day, cal)
    if event.get("kind") in ("quote", "quotes"):
        quotes = event.get("quotes", [event.get("quote")])
        if not quotes or any(not isinstance(q, dict) for q in quotes):
            raise ValueError("Missing quote observations")
        if len({q["symbol"] for q in quotes}) != len(quotes):
            raise ValueError("Duplicate quote symbol")
        quotes = sorted(
            quotes,
            key=lambda q: (
                s["stocks"].get(q["symbol"], {}).get("rank", 999),
                q["symbol"],
            ),
        )
        # Mark all fresh bids before risk checks; process exits before new intents.
        for q in quotes:
            if valid_quote(q, at) and q["symbol"] in s["positions"]:
                s["positions"][q["symbol"]].update(mark=q["bid"], mark_at=at)
        mark(s, at, cfg)
        for q in quotes:
            process_quote(s, {"at": at, "quote": q}, cfg, allow_entry=False)
        for q in quotes:
            if valid_quote(q, at):
                process_quote(s, {"at": at, "quote": q}, cfg, exits=False)
        s["last_event"] = at
        s["last_hash"] = eh
        s["data_status"] = "quote-modeled"
        s["equity_curve"].append(
            {
                "at": at,
                "equity": s["equity"],
                "cash": s["cash"],
                "exposure": sum(p["qty"] * p["mark"] for p in s["positions"].values()),
                "drawdown": s["peak"] - s["equity"],
                "halted": s["halted"],
                "stale_marks": sum(p["mark_at"] != at for p in s["positions"].values()),
            }
        )
        return s
    bs = event.get("bars", [])
    if len({b["symbol"] for b in bs}) != len(bs):
        raise ValueError("Duplicate symbol in batch")
    for b in bs:
        if (stamp(b["ts"]) + timedelta(minutes=5)).isoformat() != closed_at:
            raise ValueError("Only completed, same-close candles accepted")
        normalize(b["symbol"], [b["ts"], b["o"], b["h"], b["l"], b["c"], b["v"]])
    if s.get("last_candle") and closed_at <= s["last_candle"]:
        raise ValueError("Candle was already processed or is out of order")
    s["last_candle"] = closed_at
    regular = cal.get(day) == "regular"
    new_entries = {}
    for b in bs:
        sym = b["symbol"]
        x = s["stocks"].setdefault(
            sym,
            {
                "ema": None,
                "count": 0,
                "values": [],
                "prior_close": None,
                "prior_day": None,
                "phase": "waiting",
                "pending": None,
                "minutes": [],
                "pv": 0,
                "vol": 0,
                "last_volume": 0,
                "last_minute": None,
                "prev_close": None,
                "entered": False,
                "pending_age": 0,
                "opening": None,
                "reason": "",
                "pull_count": 0,
                "pull_low": None,
                "vwap": None,
            },
        )
        if cfg["execution"] == "candle" and sym in s["positions"]:
            s["positions"][sym]["mark"] = b["o"]
            s["positions"][sym]["mark_at"] = b["ts"]
    mark(s, at, cfg)  # conservative opening mark before admitting entries
    for b in bs:
        sym = b["symbol"]
        x = s["stocks"][sym]
        m = minute(b["ts"])
        if cfg["execution"] == "candle" and sym in s["positions"]:
            p = s["positions"][sym]
            if (
                b["ts"][:10] != p["entry_at"][:10]
                or m >= cfg["squareoff"]
                or b["o"] <= p["stop"]
            ):
                candle_exit(s, sym, {**b, "h": b["o"], "l": b["o"]}, cfg)
        if not regular or m not in range(555, 930, 5):
            invalidate(x, "unknown_or_special_session")
            continue
        if x["last_minute"] is not None and m != x["last_minute"] + 5:
            invalidate(x, "missing_candle")
            x["ema"] = None
            x["count"] = 0
            s["events"].append({"at": at, "symbol": sym, "reason": "missing_candle"})
        if m == 555:
            x["opening"] = b["o"]
            r = member(manifest, sym, day)
            x["member"] = r
            if not r:
                invalidate(x, "universe_metadata_ineligible")
            else:
                if x.get("instrument_key") and x["instrument_key"] != r.get("key"):
                    x["ema"] = None
                    x["count"] = 0
                    x["values"] = []
                    x["prior_close"] = None
                    invalidate(x, "instrument_identity_changed")
                x["instrument_key"] = r.get("key")
                x["tick"] = r["tick_size"]
                action = manifest.get("comparable", {}).get(sym, {}).get(day)
                if (
                    action is None
                    and cfg["corporate_action_policy"] == "require_review"
                ):
                    invalidate(x, "corporate_action_unresolved")
                    x["ema"] = None
                    x["count"] = 0
                    x["values"] = []
                elif action is not None and (
                    not isinstance(action, (float, int))
                    or not math.isfinite(action)
                    or action <= 0
                ):
                    invalidate(x, "corporate_action_unresolved")
                    x["ema"] = None
                    x["count"] = 0
                    x["values"] = []
                elif action is not None:
                    if x["prior_close"]:
                        x["prior_close"] *= action
                    if x["ema"]:
                        x["ema"] *= action
                prior_dates = sorted(
                    d for d, v in cal.items() if v == "regular" and d < day
                )
                if x["phase"] != "invalid" and x["prior_day"] != (
                    prior_dates[-1] if prior_dates else None
                ):
                    invalidate(x, "missing_prior_session")
            x["gap"] = b["o"] / x["prior_close"] - 1 if x["prior_close"] else None
    for b in sorted(
        bs, key=lambda b: (s["stocks"][b["symbol"]].get("rank", 999), b["symbol"])
    ):
        sym = b["symbol"]
        x = s["stocks"][sym]
        m = minute(b["ts"])
        if not regular or m not in range(555, 930, 5):
            continue
        pending = x["pending"]
        if pending:
            x["pending_age"] += 1
            if m >= cfg["entry_cutoff"]:
                invalidate(x, "entry_cutoff")
            elif (
                cfg["execution"] == "candle"
                and b["ts"] >= pending.get("eligible_from", pending["created"])
                and b["h"] >= pending["trigger"]
            ):
                if (
                    cfg.get("exclude_ambiguous_entries")
                    and b["o"] < pending["trigger"]
                    and b["l"] <= pending["stop"]
                ):
                    reject(s, sym, b["ts"], "ambiguous_entry_excluded")
                    invalidate(x, "ambiguous_entry_excluded")
                else:
                    fill = max(b["o"], pending["trigger"]) * (
                        1 + cfg["slippage_bps"] / 10000
                    )
                    if enter(
                        s,
                        sym,
                        x,
                        fill,
                        b["ts"],
                        cfg,
                        {
                            "fill_time_precision": "five-minute interval",
                            "gap_over_trigger": max(0, b["o"] - pending["trigger"]),
                            "assumed_slippage_per_share": fill
                            - max(b["o"], pending["trigger"]),
                        },
                    ):
                        new_entries[sym] = b["o"] < pending["trigger"]
            if x["pending"] and x["pending_age"] >= cfg["pending_bars"]:
                invalidate(x, "pending_expired")
        x["ema"] = b["c"] if x["ema"] is None else x["ema"] + 0.2 * (b["c"] - x["ema"])
        x["count"] += 1
        x["minutes"].append(m)
        x["last_minute"] = m
        x["pv"] += (b["h"] + b["l"] + b["c"]) / 3 * b["v"]
        x["vol"] += b["v"]
        x["vwap"] = x["pv"] / x["vol"] if x["vol"] > 0 else None
    # Intrabar exits cannot fund another entry in the same unknown-order interval.
    for b in bs:
        sym = b["symbol"]
        if cfg["execution"] == "candle" and sym in s["positions"]:
            candle_exit(s, sym, b, cfg, entry_inside=new_entries.get(sym, False))
    if not s["ranked"] and minute(closed_at) >= 560:
        s["ranked"] = True
        candidates = []
        for sym, x in s["stocks"].items():
            if x.get("last_minute") != 555:
                continue
            if x["phase"] == "invalid":
                continue
            if (
                len(x["values"]) < cfg["liquidity_sessions"]
                or x["count"] - 1 < cfg["warmup"]
            ):
                invalidate(x, "history_warmup")
                continue
            med = statistics.median(x["values"][-20:])
            x["median_value"] = med
            if med < cfg["median_value_min"]:
                invalidate(x, "liquidity")
                continue
            if x["gap"] is None or not cfg["gap_min"] <= x["gap"] <= cfg["gap_max"]:
                invalidate(x, "gap_outside_range")
                continue
            candidates.append((sym, x))
        candidates.sort(key=lambda z: (-z[1]["gap"], -z[1]["median_value"], z[0]))
        for i, (sym, x) in enumerate(candidates):
            if i < cfg["shortlist_size"]:
                x["phase"] = "selected"
                x["rank"] = i + 1
                s["shortlist"].append(
                    {
                        "symbol": sym,
                        "gap": x["gap"],
                        "median_value": x["median_value"],
                        "rank": i + 1,
                    }
                )
            else:
                invalidate(x, "shortlist_limit")
    for b in bs:
        x = s["stocks"][b["symbol"]]
        if regular and minute(b["ts"]) in range(555, 930, 5):
            transition(s, x, b, cfg, day, event.get("received_at"))
        x["prev_close"] = b["c"]
        x["last_volume"] = b["v"]
        if cfg["execution"] == "candle" and b["symbol"] in s["positions"]:
            s["positions"][b["symbol"]]["mark"] = b["c"]
            s["positions"][b["symbol"]]["mark_at"] = at
    for sym, x in s["stocks"].items():
        x["proposed_target"] = (
            (
                3 * x["pending"]["trigger"] * (1 + cfg["slippage_bps"] / 10000)
                - 2 * x["pending"]["stop"]
            )
            if x.get("pending")
            else None
        )
        x["proposed_quantity"] = (
            proposal(
                s,
                x,
                x["pending"]["trigger"] * (1 + cfg["slippage_bps"] / 10000),
                cfg,
                day,
            )[0]
            if x.get("pending")
            else None
        )
    mark(s, at, cfg)
    s["last_event"] = at
    s["last_hash"] = eh
    s["data_status"] = (
        "quote-modeled" if cfg["execution"] == "quote" else "candle-modeled"
    )
    s["equity_curve"].append(
        {
            "at": at,
            "equity": s["equity"],
            "cash": s["cash"],
            "exposure": sum(p["qty"] * p["mark"] for p in s["positions"].values()),
            "drawdown": s["peak"] - s["equity"],
            "halted": s["halted"],
            "stale_marks": sum(p["mark_at"] != at for p in s["positions"].values()),
        }
    )
    return s


def valid_quote(q, at):
    try:
        return (
            -2 <= (stamp(at) - stamp(q["source_at"])).total_seconds() <= 5
            and all(math.isfinite(q[k]) and q[k] > 0 for k in ["bid", "ask"])
            and q["bid"] <= q["ask"]
        )
    except (KeyError, ValueError, TypeError):
        return False


def process_quote(s, event, cfg, allow_entry=True, exits=True):
    if cfg["execution"] != "quote":
        raise ValueError("Quote event in candle account")
    q = event["quote"]
    sym = q["symbol"]
    at = event["at"]
    if not valid_quote(q, at):
        reject(s, sym, at, "stale_or_crossed_quote")
        return
    source = stamp(q["source_at"])
    x = s["stocks"].get(sym)
    slip = cfg["slippage_bps"] / 10000
    if exits and sym in s["positions"]:
        p = s["positions"][sym]
        p["mark"] = q["bid"]
        p["mark_at"] = at
        reason = (
            "squareoff"
            if minute(at) >= cfg["squareoff"] or p["entry_at"][:10] != at[:10]
            else (
                "stop"
                if q["bid"] <= p["stop"]
                else "target" if q["bid"] >= p["target"] else None
            )
        )
        if reason:
            close_position(
                s,
                sym,
                q["bid"] * (1 - slip),
                at,
                reason,
                cfg,
                delayed=minute(at) > cfg["squareoff"],
            )
            s["trades"][-1]["exit_details"] = {
                "quote_received": at,
                "quote_source": q["source_at"],
                "request_started": q.get("requested_at"),
                "source_clock_ahead_seconds": max(
                    0, (source - stamp(at)).total_seconds()
                ),
                "intent_at": at,
                "spread": q["ask"] - q["bid"],
                "slippage_bps": cfg["slippage_bps"],
                "depth_exceeded": q.get("bid_size") is not None
                and p["qty"] > q["bid_size"],
                "full_fill_not_proven": True,
            }
    mark(s, at, cfg)
    if (
        x
        and x.get("pending")
        and stamp(at)
        >= stamp(x["pending"].get("original_created", x["pending"]["created"]))
        + timedelta(minutes=5 * cfg["pending_bars"])
    ):
        invalidate(x, "pending_expired")
    if (
        allow_entry
        and not s.get("operational_halt")
        and x
        and x.get("pending")
        and source > stamp(x["pending"].get("observed_at", x["pending"]["created"]))
        and stamp(q.get("requested_at", q["source_at"]))
        > stamp(x["pending"].get("observed_at", x["pending"]["created"]))
        and stamp(at) > stamp(x["pending"]["created"])
        and minute(at) < cfg["entry_cutoff"]
        and q["ask"] >= x["pending"]["trigger"]
    ):
        size, _ = proposal(s, x, q["ask"] * (1 + slip), cfg, at[:10])
        details = {
            "quote_received": at,
            "quote_source": q["source_at"],
            "request_started": q.get("requested_at"),
            "source_clock_ahead_seconds": max(0, (source - stamp(at)).total_seconds()),
            "intent_at": at,
            "spread": q["ask"] - q["bid"],
            "slippage_bps": cfg["slippage_bps"],
            "depth_exceeded": q.get("ask_size") is not None and size > q["ask_size"],
            "full_fill_not_proven": True,
        }
        if enter(s, sym, x, q["ask"] * (1 + slip), at, cfg, details):
            s["positions"][sym].update(mark=q["bid"], mark_at=at)
    mark(s, at, cfg)
