# Bounded Rule-Tweak Experiment

Declared 2026-11-07 before running this extension. Research only; no orders.

The entire 2025-11-04 to 2026-11-03 period has already been inspected in the
vanilla study. All results here are exploratory, even when using chronological
splits. No claim of a new untouched holdout or statistical proof is permitted.

## Finite Search Space

- All three original modes, fixed 65-unit exposure for comparability.
- Entry windows: 09:30-14:30, 10:00-13:00, 10:30-12:30.
- Entry filters: none; EMA50 regime; EMA50 regime plus four-bar slope;
  ADX14 >=20; last fully closed 60m EMA21 regime; directional candle body >=35%
  of range with range <=1.5 ATR14; breakout beyond the completed 09:15-09:45
  opening range; first eligible entry per day only; no expiry-day entry.
- Exit profiles: original crossover/15:00; 20% premium stop; 20% stop/40%
  target; 30% stop/60% target; maximum 60-minute hold. No trailing-stop search.
- Total: 405 configurations. Do not expand the grid because results disappoint.

All signal features use data available at signal close, never future candles.
Original signals, strikes and expiry selection are unchanged. A rejected entry
does not prevent an existing position exiting at the opposite crossover. Stops
and targets end a position early, but do not trigger reentry without a new cross.

Premium barriers are relative to the adversely slipped entry fill. Inspect actual
one-minute option OHLC; gap-through stops fill at the adverse OPEN. A bar touching
both stop and target resolves to the stop. Target gaps receive only the target
price, not an invented favorable price. Apply adverse slippage and all existing
costs to exits. Stop/target activation at the entry open is allowed; intraminute
order/latency/depth are unknowable, so this remains a candle simulation.

## Selection And Acceptance

Use 120 initial complete sessions for training, then three consecutive evaluation
blocks of 42, 42 and the remaining sessions. At each boundary use expanding
training history only; select one configuration using training net / (closed-trade
drawdown + INR5000), requiring >=20 training trades, positive net and PF>=1.1.
If none qualify, remain in cash. Never choose using the next block's returns.

Assess aggregate selected out-of-sample-path net/PF, each block, trade count,
drawdown, adverse execution and profit concentration. Also report fixed original
baselines on identical dates. Any post-hoc ranking across evaluation periods is
exploratory and cannot be described as independently validated.

Reprice selected configurations with one extra minute before entry and ordinary
crossover/time exits, and with 1 premium point instead of 0.5 (always also 0.5%
per leg). Square-off remains at 15:00. Relative stops move with actual entry fill.
Stop fills are still simulated, not guaranteed executable broker fills.

Exclude a signal opportunity from ALL modes/configurations if any of the three
mode histories lacks a positive-volume minute during the original holding
interval. This common-case restriction prevents a missing stop observation
artificially benefiting one rule. Quantify exclusions and reference the original
less-restrictive endpoint-only study rather than silently merging the results.

Historical 75-unit contracts are not executable in 65-unit quantities. Re-evaluate
the selected path at actual listed lot sizes. No naked-short margin feasibility
or production trade/risk validation is implied. No live promotion merely because
the search discovers a positive net. A genuinely new forward paper period is
required before any live decision.
