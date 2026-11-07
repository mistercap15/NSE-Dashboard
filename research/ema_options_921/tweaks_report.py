"""Publish reproducible experiment results without raw market data/credentials."""
import json
from pathlib import Path

from .backtest import ROOT


def amount(value):
    return f'{value:,.2f}'


def run():
    output = ROOT / 'data/exports/ema_options_921_15m/tweaks'
    result = json.loads((output / 'results.json').read_text())
    here = Path(__file__).resolve().parent
    lead = result['retrospective_leaders'][0]
    lines = ['# 9/21 EMA: Bounded Rule-Tweak Results', '', 'Research date: 2026-11-07. All amounts INR.', '',
             '## Conclusion', '',
             'There are profitable historical configurations, but this experiment has NOT',
             'established a robust live-trading strategy. The rule-selection procedure lost',
             'money on subsequent blocks. The full-period winner is a forward-paper candidate',
             'only, chosen after viewing this sample, with low frequency and concentrated profits.', '',
             'Read TWEAK_PROTOCOL.md for the rules declared before running the extension.', '',
             '## What Was Tested', '',
             '- 405 configurations: 3 execution modes x 3 entry windows x 9 filters x 5 exits.',
             '- Entry filters: EMA50 regime; EMA50 plus four-bar slope; ADX14 >=20;',
             '  fully closed hourly EMA21 regime; directional candle body/ATR cap;',
             '  completed 09:15-09:45 opening-range breakout; first eligible entry only;',
             '  no expiry-day entries; and no filter.',
             '- Exits: original crossover/15:00; 20% premium stop; 20% stop/40% target;',
             '  30% stop/60% target; or maximum 60-minute hold.',
             '- Same 2025-11-04 through 2026-11-03 data, actual option prices, 65-unit',
             '  reference exposure, 0.5% plus 0.5 points adverse slippage each leg, tick rounding',
             '  and broker/statutory fees as the initial study.',
             '- 196/405 configurations were positive over the entire sample. This count',
             '  is not evidence of significance: the rules overlap and the sample was searched.', '',
             '## Strongest Full-Sample Candidate: RETROSPECTIVE', '',
             f"Configuration: `{lead['configuration']}`.", '',
             '1. Signals remain closed 15m spot EMA9/EMA21 crossovers.',
             '2. New entries only 10:30-12:30 IST, inclusive.',
             '3. Bullish entry requires signal close ABOVE the completed 09:15-09:45 high;',
             '   bearish entry requires signal close BELOW that range low.',
             '4. Buy ITM-5 CE on bullish signals or ITM-5 PE on bearish signals, nearest listed expiry.',
             '5. Add a 20% option-premium stop relative to actual modeled entry fill.',
             '6. Otherwise exit at the opposite crossover or 15:00. Reverse only on a fresh',
             '   qualifying cross inside the entry window. No target or same-signal reentry.', '',
             '| Metric | Result |', '| --- | ---: |',
             f"| Trades | {lead['trades']} |", f"| Win rate | {lead['win_rate']:.2f}% |",
             f"| Gross P&L | {amount(lead['gross'])} |", f"| Slippage | {amount(lead['slippage'])} |",
             f"| Broker/statutory fees | {amount(lead['fees'])} |", f"| Net P&L | {amount(lead['net'])} |",
             f"| Net profit factor | {lead['profit_factor']:.3f} |",
             f"| Net expectancy/trade | {amount(lead['expectancy'])} |",
             f"| Closed-trade drawdown | {amount(lead['closed_trade_drawdown'])} |",
             f"| Net without best five trades | {amount(lead['net_without_best_five'])} |", '',
             f"The later August-November partition has {lead['later']['trades']} trades and",
             f"{amount(lead['later']['net'])} net, but it was part of the full sample used to rank",
             'this candidate. Calling it an untouched out-of-sample result would be incorrect.', '',
             '| Full-sample candidate execution sensitivity | Net | Failed repricings |', '| --- | ---: | ---: |']
    for row in lead['sensitivity']:
        lines.append(f"| {row['name']} | {amount(row['net'])} | {row['failed_trades']} |")
    lines += ['', 'The candidate survives these modeled friction changes but still depends on a',
              'small number of winning trades. There are only 28 observations in a year;',
              'this is not a stable daily-income estimate or proof of predictive edge.', '',
              '## Sequential Rule Selection', '',
              'At each boundary choose a rule using expanding earlier data only. Require',
              'at least 20 training trades, positive training net, PF>=1.1; rank training',
              'net / (closed-trade drawdown + 5000). No evaluation-block return enters selection.',
              'The protocol itself was designed after the initial study inspected this year,',
              'so even this chronological exercise is exploratory, not external validation.', '',
              '| Subsequent block | Training sessions | Chosen rule | Trades | Net |',
              '| --- | ---: | --- | ---: | ---: |']
    for fold in result['folds']:
        lines.append(f"| {fold['test_start']} to {fold['test_end']} | {fold['train_sessions']} | `{fold['selected']}` | {fold['evaluation']['trades']} | {amount(fold['evaluation']['net'])} |")
    selected = result['selected_path']
    lines += ['', f"Combined selected path: {selected['trades']} trades; net {amount(selected['net'])};",
              f"PF {selected['profit_factor']:.3f}; closed-trade drawdown {amount(selected['closed_trade_drawdown'])}.",
              'A large training profit did not reliably transfer to the next block.', '',
              '| Selected-path sensitivity | Net | Failed repricings |', '| --- | ---: | ---: |']
    for row in result['stress']:
        lines.append(f"| {row['name']} | {amount(row['net'])} | {len(row['failed_trades'])} |")
    lines += ['', '## Same-Date Benchmarks', '',
              'The following cover the SAME sequential evaluation dates, from 2026-05-04',
              'through 2026-11-03. Do not compare them to a different full-year date range.', '',
              '| Fixed rule | Trades | Net | PF |', '| --- | ---: | ---: | ---: |']
    for row in result['benchmarks']:
        lines.append(f"| `{row['configuration']}` | {row['trades']} | {amount(row['net'])} | {row['profit_factor']:.3f} |")
    lines += ['', '## Limits And Data Treatment', '',
              '- All source hashes were checked against the initial frozen cache. No network',
              '  request, account access or order API is used by this extension.',
              f"- {len(result['rejected_common_entries'])} signal opportunities were excluded from every mode/configuration because",
              '  at least one mode lacked a positive-volume one-minute monitoring observation.',
              '  This common-case restriction differs from the original endpoint-only study.',
              '  Missingness need not be random; coverage exclusions can bias estimates.',
              '- Stop/target paths use actual one-minute OHLC; when both touch, the stop wins.',
              '  Adverse gaps use the open, target gaps do not receive a better-than-target fill.',
              '  Intraminute fill times are approximated by the minute boundary, not observed ticks.',
              '- Extra-minute stress delays entries/crossover exits but never mandatory square-off.',
              '  Premium stops move with the delayed actual modeled entry.',
              '- Reported drawdown is CLOSED-TRADE equity drawdown only; open-trade drawdown',
              '  and broker margin can be materially worse. Reference equity is INR200,000.',
              '- Historical 75-unit lots are normalized to 65 units in comparisons. Actual-lot',
              '  sensitivity is separate. Naked short-option margin feasibility is not verified.',
              '- Repeated searching inflates apparent edges. Do not expand thresholds indefinitely',
              '  or label the top full-sample result a validated strategy.', '',
              '## Next Research Step', '',
              'Freeze the opening-range/20%-stop candidate only as a hypothesis. Evaluate a',
              'longer independent history and genuinely new forward paper observations using',
              'actual bid/ask quotes, costs, stops and square-off outcomes. Predeclare review',
              'criteria. Do not enable live execution, add leverage or guarantee profits.', '',
              '## Reproduce', '', '```sh',
              'python3 -m unittest research.ema_options_921.test_backtest research.ema_options_921.test_tweaks -v',
              'python3 -m research.ema_options_921.tweaks',
              'python3 -m research.ema_options_921.tweaks_report', '```', '',
              'Requires pandas plus the original local cached data. No fresh data is fetched.',
              'CSV ledgers and all configuration metrics are in',
              '`data/exports/ema_options_921_15m/tweaks/` (Git-ignored).',
              '`tweaks_summary.json` preserves aggregates without raw payloads or credentials.',
              '11 new unit tests plus the original 16 tests cover execution/indicator edge cases.', '']
    (here / 'TWEAK_RESULTS.md').write_text('\n'.join(lines))
    (here / 'tweaks_summary.json').write_text(json.dumps(result, indent=2) + '\n')
    print(here / 'TWEAK_RESULTS.md')


if __name__ == '__main__':
    run()
