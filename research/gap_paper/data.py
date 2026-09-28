"""Read-only Upstox market data. No POST, account or order APIs exist here."""

import gzip, json, os, time, urllib.request, urllib.error, urllib.parse, hashlib
from pathlib import Path
from datetime import date, timedelta

ROOT = Path(__file__).resolve().parents[2]


class DataError(Exception):
    pass


def token():
    # Same analytics-first env/.env.local handling as existing downloader. No OAuth bot sync.
    t = os.environ.get("UPSTOX_ANALYTICS_TOKEN", "").strip()
    if not t:
        for line in (
            (ROOT / ".env.local").read_text().splitlines()
            if (ROOT / ".env.local").exists()
            else []
        ):
            k, sep, v = line.partition("=")
            if sep and k.strip() == "UPSTOX_ANALYTICS_TOKEN":
                t = v.strip().strip('"').strip("'")
    if not t:
        raise DataError(
            "Missing UPSTOX_ANALYTICS_TOKEN; configure locally, never in chat"
        )
    return t


class Client:
    def __init__(self, cache):
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.last = 0

    def get(self, path, ttl=None):
        if not any(
            path.startswith(p)
            for p in [
                "v3/historical-candle/",
                "v3/market-quote/",
                "v3/historical-candle/intraday/",
            ]
        ):
            raise DataError("Market-data endpoint not allowed")
        f = self.cache / (hashlib.sha256(path.encode()).hexdigest() + ".json")
        if f.exists() and (ttl is None or time.time() - f.stat().st_mtime < ttl):
            return json.loads(f.read_text())["response"]
        secret = token()
        for attempt in range(5):
            time.sleep(max(0, 1 - (time.monotonic() - self.last)))
            self.last = time.monotonic()
            req = urllib.request.Request(
                "https://api.upstox.com/" + path,
                headers={
                    "Authorization": "Bearer " + secret,
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0",
                },
                method="GET",
            )
            try:
                with urllib.request.urlopen(req, timeout=25) as r:
                    data = json.load(r)
                if data.get("status") != "success":
                    raise DataError("Market data returned unsuccessful status")
                tmp = f.with_suffix(".tmp")
                tmp.write_text(
                    json.dumps(
                        {"path": path, "retrieved_at": time.time(), "response": data}
                    )
                )
                tmp.replace(f)
                return data
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    raise DataError(
                        "Upstox authentication/access rejected HTTP " + str(e.code)
                    ) from None
                if e.code == 429 or e.code >= 500:
                    time.sleep(min(2**attempt, 16))
                    continue
                raise DataError("Upstox market-data HTTP " + str(e.code)) from None
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
                time.sleep(min(2**attempt, 16))
        raise DataError("Upstox retries exhausted")

    def history(self, key, start, end):
        return self.get(
            f'v3/historical-candle/{urllib.parse.quote(key,safe="")}/minutes/5/{end}/{start}'
        )["data"]["candles"]

    def intraday(self, key):
        return self.get(
            f'v3/historical-candle/intraday/{urllib.parse.quote(key,safe="")}/minutes/5',
            ttl=15,
        )["data"]["candles"]

    def quotes(self, keys):
        return self.get(
            "v3/market-quote/quotes?instrument_key="
            + urllib.parse.quote(",".join(keys), safe=""),
            ttl=1,
        )


def master():
    req = urllib.request.Request(
        "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(gzip.decompress(r.read()))


def format_telegram(signal):
    return f"PAPER — NO LIVE ORDERS\n{signal['symbol']} trigger {signal['trigger']:.2f}, stop {signal['stop']:.2f}"
