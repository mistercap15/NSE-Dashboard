import hashlib, json, tempfile, unittest, urllib.error
from pathlib import Path
from unittest.mock import patch
from .data import Client, DataError


class DataTests(unittest.TestCase):
    def test_non_market_endpoint_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(DataError):
                Client(d).get("v2/order/place")

    def test_cache_does_not_read_credentials_or_network(self):
        with tempfile.TemporaryDirectory() as d:
            path = "v3/historical-candle/NSE_EQ%7CX/minutes/5/2026-09-25/2026-09-01"
            (
                Path(d) / (hashlib.sha256(path.encode()).hexdigest() + ".json")
            ).write_text(
                json.dumps({"response": {"status": "success", "data": {"candles": []}}})
            )
            with patch(
                "research.gap_paper.data.token",
                side_effect=AssertionError("must not read credentials"),
            ), patch(
                "urllib.request.urlopen", side_effect=AssertionError("must not fetch")
            ):
                self.assertEqual(Client(d).get(path)["data"]["candles"], [])

    def test_auth_failure_is_sanitized_and_not_retried(self):
        with tempfile.TemporaryDirectory() as d, patch(
            "research.gap_paper.data.token", return_value="synthetic-test-only"
        ), patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.HTTPError(
                "https://api.upstox.com", 401, "unauthorized", {}, None
            ),
        ) as urlopen:
            with self.assertRaisesRegex(
                DataError, "authentication/access rejected HTTP 401"
            ):
                Client(d).get("v3/market-quote/quotes?instrument_key=X")
            self.assertEqual(urlopen.call_count, 1)

    def test_transient_failure_has_bounded_retry(self):
        with tempfile.TemporaryDirectory() as d, patch(
            "research.gap_paper.data.token", return_value="synthetic-test-only"
        ), patch("time.sleep"), patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.HTTPError(
                "https://api.upstox.com", 429, "rate limit", {}, None
            ),
        ) as urlopen:
            with self.assertRaisesRegex(DataError, "retries exhausted"):
                Client(d).get("v3/market-quote/quotes?instrument_key=X")
            self.assertEqual(urlopen.call_count, 5)


if __name__ == "__main__":
    unittest.main()
