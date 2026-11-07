"""Generate the research report and a non-secret summary suitable for Git."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data/exports/ema_options_921_15m'
HERE = Path(__file__).resolve().parent


def money(value):
    return f'{value:,.2f}'


def hm(minutes):
    return f'{minutes // 60:02}:{minutes % 60:02}'


def run():
    results = json.loads((OUT / 'results.json').read_text())
    audit = json.loads((OUT / 'audit.json').read_text())
    content = [
        '# NIFTY 9/21 EMA Options: 15-Minute Feasibility Study',
        '', 'Research date: 2026-11-07. All currency amounts below are INR.', '',
        '## Decision', '',
        '**Do not automate live trading yet.** The predeclared broad baseline loses',
        'money after modeled friction in all three execution modes. A narrower ATM-buy',
        'candidate merits forward paper testing, not a profitability claim or live approval.',
        '', '## Data And Scope', '',
        f"- Evaluation: {results['start']} through {results['end']}; {results['complete_sessions']} complete regular sessions.",
        f"- Actual Upstox data: {results['spot_minutes_including_warmup']:,} NIFTY spot minutes including warmup; {results['option_minutes']:,} option minutes across {results['option_contracts']} expired contracts.",
        '- End date is the latest completed expiry in this study, not an attempt to model still-active contracts.',
        '- Spot warmup starts 35 calendar days before evaluation; 100 completed 15m bars required before signals.',
        '- One incomplete/special spot session, 2025-10-21, was excluded in warmup; no evaluation session present in the downloaded series was incomplete.',
        '- Zero planned entry/exit trades excluded across the 63 mode/window combinations.',
        '- Calendar coverage is based on observed complete regular sessions, not an independently reconciled exchange holiday calendar. A wholly absent provider session cannot be detected by this check.',
        '- This is a research script, not the dashboard or a live execution engine. No order/account API exists in the client.',
        '', '## Frozen Execution Interpretation', '',
        '- EMA9/EMA21 are recursive, seeded from the first warmup close and carried across sessions. No daily reset.',
        '- Only completed 15m spot candles aligned to 09:15 can signal. Strict side changes count; equal EMAs are neutral and retain the last nonzero side.',
        '- A 09:15-09:30 signal fills at the option 09:30 one-minute OPEN, never at the just-completed spot candle close. This assumes zero processing delay at the boundary; a full extra minute is tested separately.',
        '- Baseline entry window 09:30-14:30 inclusive, evaluated using signal close time. Exit on the opposite cross regardless of window; reverse only inside the window.',
        '- A position is not opened simply because the EMAs are already aligned when the window starts. A fresh eligible cross is required.',
        '- Square-off uses the option 15:00 OPEN, taking precedence over a 15:00 cross. No entry/hold after 15:00; no stop-loss was added.',
        '- Nearest listed expiry on/after the trading date, including expiry day. ATM uses signal-time spot; exact ties go to the higher listed strike.',
        '- ITM5 means five LISTED strikes below ATM for CE or above ATM for PE, not five points. Contract stays fixed throughout each trade.',
        '- Bullish: buy CE or sell PE. Bearish: buy PE or sell CE. ATM selling is naked short exposure, not a hedged spread.',
        '- Exact fill candles require positive open and traded volume. No interpolation or theoretical option premiums. Bar opens do not establish bid/ask executability or available depth.',
        '- Baseline quantity is the requested fixed 65 units. Historical contracts include 75-unit lots, so some 65-unit historical trades are exposure-normalized, not then-executable whole lots. Actual-one-lot sizing is tested separately.',
        '- Reference starting equity is INR 200,000, with no compounding. Short-option historical SPAN/exposure margins and capital feasibility were NOT reconstructed.',
        '', '## Costs', '',
        '- Each buy fill = raw premium + 0.5% + 0.5 points, rounded UP to a 0.05 tick.',
        '- Each sell fill = raw premium - 0.5% - 0.5 points, floored DOWN to a 0.05 tick and bounded below by zero.',
        '- Brokerage: INR 20 per executed order, two orders per completed trade. This conservative flat assumption does not reproduce plan-specific API discounts.',
        '- STT: 0.10% of sell premium through 2026-03-31, 0.15% from 2026-04-01. No exercise-STT scenario because the model exits before expiry close.',
        '- NSE option transaction charge: 0.03503% through 2026-02-28; 0.03553% from 2026-03-01, using the published broker schedule.',
        '- IPFT: 0.0005% before 2026-03-01, zero additional separately charged afterward under the modeled bundled broker rate. Not double-counted.',
        '- SEBI fee: INR 10/crore turnover; stamp: 0.003% of buy premium; GST: 18% on brokerage + exchange + IPFT + SEBI (conservatively includes SEBI).',
        '- Charges use unrounded per-trade decimals, not broker contract-note/daily tax rounding. Subscription, hosting, personal income tax and financing costs are excluded.',
        '', '## Broad Baseline Results', '',
        '| Mode | Trades | Win % | Gross | Slippage | Fees | Net | Net PF | Net/trade | Sampled MTM DD |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ]
    for row in results['baseline']:
        content.append(f"| {row['mode']} | {row['trades']} | {row['win_rate']:.2f} | {money(row['gross'])} | {money(row['slippage'])} | {money(row['fees'])} | {money(row['net'])} | {row['profit_factor']:.3f} | {money(row['expectancy'])} | {money(row['sampled_mtm_drawdown'])} |")
    content += ['', '- Each mode trades on 136 sessions and has 111 no-trade sessions under the broad baseline.',
                '- MTM drawdown is sampled at one-minute CLOSE liquidation values with modeled exit costs, not tick-level or worst intrabar drawdown. Percentage drawdowns use running equity peaks on the reference capital, not margin returns.',
                '- ITM5 has 14 missing/untraded interim mark minutes, despite complete endpoint fills; its sampled drawdown can understate risk. ATM baseline marks have no missing minutes.',
                '', '## Temporal Check And Window Selection', '',
                'All 21 entry windows (three starts x seven cutoffs) are reported per mode.',
                'Development is before 2026-08-01; the later partition is 2026-08-01 onward.',
                'For each mode, the window below is chosen by DEVELOPMENT net only.',
                'The mode comparison and this study are still retrospective research, not an untouched external validation.',
                '', '| Mode | Selected entry window | Development net | Later net | Later trades | Later PF | Full net | Later net with +1m delay |',
                '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for row in results['development_selected']:
        content.append(f"| {row['mode']} | {hm(row['start'])}-{hm(row['cutoff'])} | {money(row['development_net'])} | {money(row['holdout_net'])} | {row['holdout_trades']} | {row['holdout_profit_factor']:.3f} | {money(row['net'])} | {money(row['delayed_holdout_net'])} |")
    candidate = next(row for row in results['development_selected'] if row['mode'] == 'ATM_BUY')
    content += ['', '### Candidate: ATM Buy, 10:30-12:30', '',
                f"- {candidate['trades']} trades; full-period net {money(candidate['net'])}; PF {candidate['profit_factor']:.3f}; win rate {candidate['win_rate']:.2f}%.",
                f"- Sampled MTM drawdown {money(candidate['sampled_mtm_drawdown'])}, versus closed-trade drawdown {money(candidate['closed_trade_drawdown'])}.",
                f"- A full additional minute of execution delay leaves full-period net {money(candidate['delayed_net'])} and later-period net {money(candidate['delayed_holdout_net'])}.",
                f"- Remove the five best trades and full-period net becomes {money(candidate['net_without_best_five_trades'])}: profits are concentrated.",
                f"- Exploratory 95% block-bootstrap total-net interval: [{money(candidate['bootstrap']['total_net_95pct_low'])}, {money(candidate['bootstrap']['total_net_95pct_high'])}]. It includes zero and is NOT adjusted for selecting among windows/modes.",
                '- Only 16 later-period trades: far too small to establish a reliable live edge.',
                '', '| Candidate sensitivity | Full-period net | Later-period net |', '| --- | ---: | ---: |']
    for variant in candidate['sensitivity']:
        content.append(f"| 0.5% + {variant['fixed_points']} points/leg; {variant['sizing']} | {money(variant['net'])} | {money(variant['holdout_net'])} |")
    positive = sum(row['net'] > 0 for row in results['all_windows'])
    content += ['', f'{positive}/63 full-period combinations are net positive. Picking the highest full-period return would use the later data for selection and would not establish out-of-sample performance.',
                '', '## Recommendation', '',
                '1. Do not enable the broad 09:30-14:30 strategy live: all three modes lose after the stated friction.',
                '2. If proceeding, freeze ATM buying with entries 10:30-12:30 as a PAPER-ONLY candidate. Do not promote the full-sample highest-return ITM window just because it ranks first retrospectively.',
                '3. Gather genuinely new forward quotes/fills, including spread, delay, rejected entries and square-off behavior. Predeclare a new observation period and review criteria before seeing its results; a fixed trade count alone does not prove an edge.',
                '4. Expand independent historical regimes and stress capital/risk before considering live execution. No short-option automation without historical/current margin checks and explicit loss limits.',
                '', '## Verification And Reproduction', '',
                '- 16 synthetic unit tests cover closed-bar alignment, warmup/equality, prefix invariance, reversals, window boundaries, strikes, cost changes, tick rounding, missing fills, delay, MTM and the read-only API boundary.',
                f"- Independent pandas {audit['pandas']} audit reconstructs {audit['independent_15m_bars']} 15m bars and validates EMAs/signals and all {audit['audited_baseline_trades']} baseline fills against actual cached option opens.",
                '- All source-response SHA-256 hashes and trade/cost identities reconcile. Repeated cached runs make zero network requests.',
                '', '```sh', 'python3 -m unittest research.ema_options_921.test_backtest -v',
                'python3 -m research.ema_options_921.backtest', 'python3 -m research.ema_options_921.audit',
                'python3 -m research.ema_options_921.report', '```', '',
                'Python standard library is sufficient for the runner/tests/report. The independent audit additionally requires pandas. Read-only analytics credentials are resolved locally; never paste them into a report or Git.',
                '', 'Raw responses and all CSV artifacts are in `data/exports/ema_options_921_15m/` (Git-ignored).',
                'They include each baseline and development-selected trade ledger, sampled equity curves, all-window metrics, monthly/temporal metrics, exclusions, sensitivities and hash manifests.',
                '`results_summary.json` alongside this report preserves aggregate results/audit metadata without broker credentials or raw market payloads.',
                '', '## Primary References', '',
                '- https://upstox.com/developer/api-documentation/get-expired-historical-candle-data/',
                '- https://upstox.com/developer/api-documentation/get-expired-option-contracts/',
                '- https://upstox.com/brokerage-charges/',
                '- https://www.nseindia.com/static/products-services/equity-derivatives-securities-transaction-tax',
                '- https://nsearchives.nseindia.com/content/circulars/FA73061.pdf',
                '', 'This research neither starts a service nor changes any broker position/order. Historical simulated profitability is not a guarantee of future returns.', '']
    (HERE / 'REPORT.md').write_text('\n'.join(content))
    (HERE / 'results_summary.json').write_text(json.dumps({**results, 'audit': audit}, indent=2) + '\n')
    print(HERE / 'REPORT.md')


if __name__ == '__main__':
    run()
