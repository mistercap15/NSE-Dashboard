import { Resend } from "resend"

const resend     = new Resend(process.env.RESEND_API_KEY)
const FROM_EMAIL = "onboarding@resend.dev"
const TO_EMAIL   = process.env.ALERT_EMAIL
  ? process.env.ALERT_EMAIL.split(",").map(e => e.trim())
  : []

const MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec"
]

// ── Shared CSS (light mode only) ─────────────────────────────────
const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #f5f5f0;
    font-family: -apple-system, BlinkMacSystemFont,
      'Segoe UI', sans-serif;
    color: #111827;
    -webkit-font-smoothing: antialiased;
  }
  .wrap {
    max-width: 620px;
    margin: 0 auto;
    padding: 24px 16px;
  }
  .email-body {
    background: #ffffff;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #e0ddd6;
  }
  .header {
    background: #0f172a;
    padding: 28px 28px 24px;
  }
  .header-label {
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #60a5fa;
    margin-bottom: 6px;
  }
  .header-title {
    font-size: 22px;
    font-weight: 600;
    color: #f8fafc;
    margin-bottom: 4px;
  }
  .header-sub { font-size: 12px; color: #94a3b8; }
  .header-badge {
    display: inline-block;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    margin-top: 16px;
  }
  .badge-action {
    background: #16a34a20;
    border: 1px solid #16a34a40;
    color: #22c55e;
  }
  .badge-watch {
    background: #d9770620;
    border: 1px solid #d9770640;
    color: #fbbf24;
  }
  .badge-clear {
    background: #1d4ed820;
    border: 1px solid #1d4ed840;
    color: #60a5fa;
  }
  .content { padding: 24px 28px; background: #ffffff; }
  .section-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .label-green  { color: #16a34a; }
  .label-amber  { color: #d97706; }
  .label-blue   { color: #1d4ed8; }
  .label-gray   { color: #6b7280; }
  .signal-card {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 18px;
    margin-bottom: 16px;
    background: #ffffff;
  }
  .border-green { border-left: 3px solid #16a34a; }
  .border-amber { border-left: 3px solid #f59e0b; }
  .sig-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 14px;
    flex-wrap: wrap;
    gap: 10px;
  }
  .symbol {
    font-family: 'Courier New', monospace;
    font-size: 20px;
    font-weight: 700;
    color: #1e40af;
  }
  .sector-text { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .status-badge {
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 700;
  }
  .badge-enter {
    background: #dcfce7;
    border: 1px solid #86efac;
    color: #15803d;
  }
  .badge-near {
    background: #fef3c7;
    border: 1px solid #fcd34d;
    color: #92400e;
  }
  .stats-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  .stat-box {
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    border-radius: 7px;
    padding: 10px;
  }
  .stat-label {
    font-size: 9px;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 3px;
  }
  .stat-val {
    font-family: 'Courier New', monospace;
    font-size: 15px;
    font-weight: 600;
    color: #111827;
  }
  .val-green { color: #16a34a; }
  .val-blue  { color: #1d4ed8; }
  .val-amber { color: #d97706; }
  .support-box {
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 7px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  .support-title {
    font-size: 11px;
    font-weight: 600;
    color: #92400e;
    margin-bottom: 3px;
  }
  .support-sub { font-size: 11px; color: #78716c; }
  .action-box {
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    border-radius: 7px;
    padding: 12px 14px;
  }
  .action-box-label {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: #6b7280;
    margin-bottom: 10px;
  }
  .action-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 4px 0;
    border-bottom: 1px solid #f3f4f6;
    font-size: 12px;
    gap: 12px;
  }
  .action-row:last-child { border-bottom: none; }
  .action-key { color: #6b7280; white-space: nowrap; }
  .action-val { font-weight: 500; color: #111827; text-align: right; }
  .val-r { color: #dc2626; }
  .val-g { color: #16a34a; }
  .val-a { color: #d97706; }
  .caution-box {
    margin-top: 10px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11px;
    color: #92400e;
  }
  .divider {
    height: 1px;
    background: #f3f4f6;
    margin: 24px 0;
  }
  .pos-card {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 12px;
  }
  .pos-header {
    background: #f8fafc;
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #e5e7eb;
    flex-wrap: wrap;
    gap: 10px;
  }
  .pos-symbol {
    font-family: 'Courier New', monospace;
    font-size: 15px;
    font-weight: 700;
    color: #1e40af;
  }
  .pos-meta { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .pos-pnl {
    font-family: 'Courier New', monospace;
    font-size: 16px;
    font-weight: 700;
    text-align: right;
  }
  .pos-pct { font-size: 11px; text-align: right; }
  .pnl-profit { color: #16a34a; }
  .pnl-loss   { color: #dc2626; }
  .pos-body { padding: 12px 16px; }
  .progress-label {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #6b7280;
    margin-bottom: 5px;
  }
  .progress-pct { font-weight: 600; color: #16a34a; }
  .progress-bar {
    height: 5px;
    background: #e5e7eb;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 12px;
  }
  .progress-fill {
    height: 100%;
    border-radius: 3px;
  }
  .fill-green  { background: #16a34a; }
  .fill-blue   { background: #1d4ed8; }
  .fill-amber  { background: #f59e0b; }
  .fill-red    { background: #dc2626; }
  .rec-box {
    border-radius: 7px;
    padding: 10px 12px;
  }
  .rec-exit   { background:#f0fdf4; border:1px solid #bbf7d0; }
  .rec-trail  { background:#eff6ff; border:1px solid #bfdbfe; }
  .rec-time   { background:#fffbeb; border:1px solid #fde68a; }
  .rec-hold   { background:#f9fafb; border:1px solid #e5e7eb; }
  .rec-title  { font-size:12px; font-weight:600; margin-bottom:3px; }
  .rec-reason { font-size:11px; color:#374151; line-height:1.5; }
  .rt-exit  { color:#15803d; }
  .rt-trail { color:#1d4ed8; }
  .rt-time  { color:#92400e; }
  .rt-hold  { color:#374151; }
  .pos-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 12px;
  }
  .pos-stat {
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 8px 10px;
  }
  .ps-label { font-size: 9px; color: #9ca3af; text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 2px; }
  .ps-value { font-family: 'Courier New', monospace;
    font-size: 12px; font-weight: 600; color: #111827; }
  .footer {
    background: #f8fafc;
    border-top: 1px solid #e5e7eb;
    padding: 16px 28px;
    text-align: center;
  }
  .footer-text { font-size: 11px; color: #9ca3af; }
  .footer-credit {
    font-size: 11px; color: #1d4ed8;
    font-weight: 600; margin-top: 3px;
  }
`

// ── Helpers ───────────────────────────────────────────────────────
function fmt(n) {
  return (n || 0).toLocaleString("en-IN")
}
function fmtPct(n) {
  const v = n || 0
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%"
}
function now() {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  })
}

// ── Signal card HTML ──────────────────────────────────────────────
function signalCard(s) {
  const isStrong    = s.status === "BUY"
  const borderClass = isStrong ? "border-green" : "border-amber"
  const badgeClass  = isStrong ? "badge-enter" : "badge-near"
  const badgeLabel  = isStrong ? "ENTER NOW" : "NEAR ENTRY"
  const targetMonth = MONTHS[(s.nextMonth?.month || 1) - 1]
  const support     = s.support?.nearest
  const price       = s.price?.current
  const lotSize     = s.lot_size || 0
  const notional    = price && lotSize
    ? (price * lotSize / 100000).toFixed(2) + "L" : "—"
  const targetPrice = price && s.nextMonth?.median_return
    ? "&#8377;" + fmt(Math.round(
        price * (1 + s.nextMonth.median_return / 100)
      )) : "—"
  const entryLabel  = isStrong
    ? "&#8377;" + fmt(price) + " (now)"
    : "&#8377;" + fmt(support?.price) + " (wait for dip)"
  const entryClass  = isStrong ? "val-g" : "val-a"
  const slPrice     = s.context?.ma50
    ? "&#8377;" + fmt(Math.round(s.context.ma50 * 0.97))
      + " (3% below 10wk avg)"
    : price ? "&#8377;" + fmt(Math.round(price * 0.93)) + " (7% below entry)"
    : "—"
  const supportType =
    support?.type === "MA20"        ? "4-week average"   :
    support?.type === "MA50"        ? "10-week average"  :
    support?.type === "SWING_LOW"   ? "recent price floor" :
    support?.type === "PREV_MONTH_LOW" ? "last month low" :
    support?.type || "support zone"
  const supportText = isStrong
    ? "Price is at this zone right now — good entry"
    : "Set a price alert here — enter when price reaches it"

  return `
    <div class="signal-card ${borderClass}">
      <div class="sig-header">
        <div>
          <div class="symbol">${s.symbol}</div>
          <div class="sector-text">
            ${s.sector || ""} &middot;
            Score: ${s.signal?.score || 0}/100 &middot;
            ${targetMonth} contract
          </div>
        </div>
        <div class="status-badge ${badgeClass}">${badgeLabel}</div>
      </div>

      <div class="stats-row">
        <div class="stat-box">
          <div class="stat-label">${targetMonth} win rate</div>
          <div class="stat-val val-green">
            ${(s.nextMonth?.win_rate || 0).toFixed(1)}%
          </div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Median return</div>
          <div class="stat-val val-green">
            +${(s.nextMonth?.median_return || 0).toFixed(1)}%
          </div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Current price</div>
          <div class="stat-val val-blue">
            &#8377;${fmt(price)}
          </div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Notional/lot</div>
          <div class="stat-val">${notional}</div>
        </div>
      </div>

      ${support ? `
        <div class="support-box">
          <div class="support-title">
            Support zone: &#8377;${fmt(support.price)}
            (${supportType}) &mdash;
            ${s.support?.distancePct}% below current
          </div>
          <div class="support-sub">${supportText}</div>
        </div>
      ` : ""}

      <div class="action-box">
        <div class="action-box-label">Your action plan</div>
        <div class="action-row">
          <span class="action-key">Enter at</span>
          <span class="action-val ${entryClass}">${entryLabel}</span>
        </div>
        <div class="action-row">
          <span class="action-key">Stop loss</span>
          <span class="action-val val-r">${slPrice}</span>
        </div>
        <div class="action-row">
          <span class="action-key">Target</span>
          <span class="action-val val-g">
            ${targetPrice}
            (+${(s.nextMonth?.median_return || 0).toFixed(1)}% median)
          </span>
        </div>
        <div class="action-row">
          <span class="action-key">Contract</span>
          <span class="action-val">
            ${s.symbol} ${targetMonth} Futures &middot;
            Lot: ${fmt(lotSize)} shares
          </span>
        </div>
        <div class="action-row">
          <span class="action-key">Fallback</span>
          <span class="action-val val-a">
            Enter at market on 22nd if no dip
          </span>
        </div>
      </div>

      ${s.checklist?.result === "CAUTION" ? `
        <div class="caution-box">
          &#9888; ${s.checklist.summary}
        </div>
      ` : ""}
      ${s.checklist?.result === "FAIL" ? `
        <div class="caution-box" style="background:#fef2f2;
          border-color:#fecaca; color:#991b1b;">
          &#10007; Checklist failed &mdash; trade with extra caution
        </div>
      ` : ""}
    </div>
  `
}

// ── Position card HTML ────────────────────────────────────────────
function positionCard(p) {
  const pnl       = p.pnl
  const rec       = p.recommendation
  const isProfit  = (pnl?.total || 0) >= 0
  const pnlClass  = isProfit ? "pnl-profit" : "pnl-loss"
  const capture   = pnl?.medianCapture || 0
  const fillClass =
    capture >= 90 ? "fill-green" :
    capture >= 60 ? "fill-blue"  :
    capture >= 30 ? "fill-amber" : "fill-red"
  const recClass  =
    rec?.action === "EXIT_NOW"   ? "rec-exit"  :
    rec?.action === "TRAIL_STOP" ? "rec-trail" :
    rec?.action === "TIME_STOP"  ? "rec-time"  : "rec-hold"
  const recTClass =
    rec?.action === "EXIT_NOW"   ? "rt-exit"  :
    rec?.action === "TRAIL_STOP" ? "rt-trail" :
    rec?.action === "TIME_STOP"  ? "rt-time"  : "rt-hold"

  return `
    <div class="pos-card">
      <div class="pos-header">
        <div>
          <div class="pos-symbol">${p.symbol}</div>
          <div class="pos-meta">
            ${p.direction} &middot;
            Entry &#8377;${fmt(p.entryPrice)} &middot;
            ${p.timing?.daysInTrade || 0} days ago &middot;
            ${p.timing?.daysRemaining || 0} days left
          </div>
        </div>
        ${pnl ? `
          <div>
            <div class="pos-pnl ${pnlClass}">
              ${isProfit ? "+" : "-"}&#8377;${fmt(Math.abs(pnl.total))}
            </div>
            <div class="pos-pct ${pnlClass}">
              ${fmtPct(pnl.returnPct)}
            </div>
          </div>
        ` : ""}
      </div>

      <div class="pos-body">
        ${pnl ? `
          <div class="pos-grid">
            <div class="pos-stat">
              <div class="ps-label">Live price</div>
              <div class="ps-value">&#8377;${fmt(p.livePrice)}</div>
            </div>
            <div class="pos-stat">
              <div class="ps-label">Median target</div>
              <div class="ps-value">
                &#8377;${fmt(Math.round(
                  p.entryPrice * (1 + (p.medianReturn || 0) / 100)
                ))}
                (+${p.medianReturn || 0}%)
              </div>
            </div>
          </div>
          <div class="progress-label">
            <span>
              Median captured (target: ${fmtPct(p.medianReturn || 0)})
            </span>
            <span class="progress-pct">${capture}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${fillClass}"
              style="width:${Math.min(capture, 100)}%;">
            </div>
          </div>
        ` : `
          <div class="pos-grid">
            <div class="pos-stat">
              <div class="ps-label">Entry price</div>
              <div class="ps-value">&#8377;${fmt(p.entryPrice)}</div>
            </div>
            <div class="pos-stat">
              <div class="ps-label">Target (+${p.medianReturn || 0}%)</div>
              <div class="ps-value">
                &#8377;${fmt(Math.round(
                  p.entryPrice * (1 + (p.medianReturn || 0) / 100)
                ))}
              </div>
            </div>
          </div>
        `}
        ${rec ? `
          <div class="rec-box ${recClass}">
            <div class="rec-title ${recTClass}">${rec.title}</div>
            <div class="rec-reason">${rec.reason}</div>
          </div>
        ` : ""}
      </div>
    </div>
  `
}

// ── Email wrapper ─────────────────────────────────────────────────
function wrapEmail(headerTitle, headerSub, badgeClass,
                   badgeText, bodyContent) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,
        initial-scale=1.0">
      <meta name="color-scheme" content="light">
      <meta name="supported-color-schemes" content="light">
      <style>${css}</style>
    </head>
    <body>
      <div class="wrap">
        <div class="email-body">
          <div class="header">
            <div class="header-label">
              NSE F&amp;O Dashboard
            </div>
            <div class="header-title">${headerTitle}</div>
            <div class="header-sub">${headerSub}</div>
            <div class="header-badge ${badgeClass}">
              ${badgeText}
            </div>
          </div>
          <div class="content">${bodyContent}</div>
          <div class="footer">
            <div class="footer-text">
              NSE F&amp;O Dashboard &middot; Real NSE data &middot;
              Not SEBI-registered advice &middot; Trade at your own risk
            </div>
            <div class="footer-credit">Crafted by Khilan Patel</div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `
}

// ── ALERT 1: Early Entry Signal ───────────────────────────────────
export async function sendEarlyEntryAlert(signals) {
  if (!TO_EMAIL) return { sent: false, reason: "ALERT_EMAIL not set" }

  const actionable = (signals || []).filter(s =>
    s.status === "BUY" || s.status === "BUY_HALF"
  )
  if (actionable.length === 0) {
    return { sent: false, reason: "No actionable signals" }
  }

  const buyNow  = actionable.filter(s => s.status === "BUY")
  const buyHalf = actionable.filter(s => s.status === "BUY_HALF")

  const subject = buyNow.length > 0
    ? `Entry Signal — ${buyNow.map(s => s.symbol).join(", ")}`
    : `Entry Zone — ${buyHalf.map(s => s.symbol).join(", ")}`

  const badgeClass = buyNow.length > 0 ? "badge-action" : "badge-watch"
  const badgeText  = buyNow.length > 0 ? "ACTION NEEDED" : "SET PRICE ALERT"
  const title      = buyNow.length > 0
    ? "Entry Signal Detected"
    : "Entry Zone Approaching"
  const sub = `${now()} IST &middot; ${actionable.length} signal${
    actionable.length !== 1 ? "s" : ""} found`

  let body = ""

  if (buyNow.length > 0) {
    body += `
      <div class="section-label label-green">
        Enter now &mdash; price at support
      </div>
      ${buyNow.map(signalCard).join("")}
    `
  }

  if (buyHalf.length > 0) {
    body += `
      <div class="section-label label-amber"
        style="margin-top:${buyNow.length > 0 ? "8px" : "0"}">
        Approaching entry zone &mdash; set price alert
      </div>
      ${buyHalf.map(signalCard).join("")}
    `
  }

  const html = wrapEmail(title, sub, badgeClass, badgeText, body)

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL, to: TO_EMAIL, subject, html,
    })
    return { sent: true, id: result.id, count: actionable.length }
  } catch (e) {
    console.error("Early entry email failed:", e.message)
    return { sent: false, error: e.message }
  }
}

// ── ALERT 2: Daily Position Update ───────────────────────────────
export async function sendPositionAlert(positions) {
  if (!TO_EMAIL) return { sent: false, reason: "ALERT_EMAIL not set" }
  if (!positions || positions.length === 0) {
    return { sent: false, reason: "No positions" }
  }

  const exitNow   = positions.filter(p =>
    p.recommendation?.action === "EXIT_NOW")
  const trailStop = positions.filter(p =>
    p.recommendation?.action === "TRAIL_STOP")
  const timeStop  = positions.filter(p =>
    p.recommendation?.action === "TIME_STOP")
  const holding   = positions.filter(p =>
    p.recommendation?.action === "HOLD" ||
    p.recommendation?.action === "WATCH")

  const hasAction = exitNow.length > 0 ||
                    trailStop.length > 0 ||
                    timeStop.length > 0

  const subject = exitNow.length > 0
    ? `Exit Now — ${exitNow.map(p => p.symbol).join(", ")}`
    : trailStop.length > 0
    ? `Move Stop Loss — ${trailStop.map(p => p.symbol).join(", ")}`
    : timeStop.length > 0
    ? `Time Stop — ${timeStop.map(p => p.symbol).join(", ")}`
    : `All Clear — ${positions.length} position${
        positions.length !== 1 ? "s" : ""} on track`

  const badgeClass = hasAction ? "badge-action" : "badge-clear"
  const badgeText  = hasAction ? "ACTION NEEDED" : "ALL CLEAR"
  const title      = "Market Close Report"
  const sub        = `${now()} IST &middot; ${positions.length} open position${
    positions.length !== 1 ? "s" : ""}`

  const posSection = (labelClass, labelText, items) => {
    if (items.length === 0) return ""
    return `
      <div class="section-label ${labelClass}">
        ${labelText}
      </div>
      ${items.map(positionCard).join("")}
    `
  }

  const body = [
    posSection("label-green", "Exit now &mdash; target reached",    exitNow),
    exitNow.length && (trailStop.length || timeStop.length || holding.length)
      ? '<div class="divider"></div>' : "",
    posSection("label-blue",  "Move stop loss",               trailStop),
    trailStop.length && (timeStop.length || holding.length)
      ? '<div class="divider"></div>' : "",
    posSection("label-amber", "Time stop warning",            timeStop),
    timeStop.length && holding.length
      ? '<div class="divider"></div>' : "",
    posSection("label-gray",  "Holding &mdash; on track",    holding),
  ].join("")

  const html = wrapEmail(title, sub, badgeClass, badgeText, body)

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL, to: TO_EMAIL, subject, html,
    })
    return { sent: true, id: result.id }
  } catch (e) {
    console.error("Position email failed:", e.message)
    return { sent: false, error: e.message }
  }
}
