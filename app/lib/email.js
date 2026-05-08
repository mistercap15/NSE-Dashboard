import { Resend } from "resend"

const resend     = new Resend(process.env.RESEND_API_KEY)
const FROM_EMAIL = "onboarding@resend.dev"
const TO_EMAIL   = process.env.ALERT_EMAIL

const MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec"
]

// ── Shared styles ─────────────────────────────────────────────────
const S = {
  body:   "margin:0;padding:0;background:#090E1A;font-family:-apple-system,BlinkMacSystemFont,sans-serif;",
  wrap:   "max-width:660px;margin:0 auto;padding:24px;",
  card:   "background:#0E1525;border:1px solid #1E2D45;border-radius:10px;padding:20px;margin-bottom:16px;",
  label:  "font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;",
  mono:   "font-family:monospace;",
  green:  "color:#22C55E;",
  red:    "color:#EF4444;",
  amber:  "color:#F59E0B;",
  accent: "color:#4D9FFF;",
  dim:    "color:#64748B;",
  soft:   "color:#94A3B8;",
  text:   "color:#E2E8F0;",
}

function footer() {
  return `
    <div style="text-align:center;padding:20px 0 8px;">
      <div style="font-size:11px;${S.dim}">
        NSE F&amp;O Dashboard · Real NSE data · Not SEBI advice
      </div>
      <div style="font-size:11px;${S.accent}font-weight:600;margin-top:4px;">
        Crafted by Khilan Patel
      </div>
    </div>
  `
}

function statBox(label, value, color) {
  return `
    <div style="background:#131D30;border-radius:6px;padding:10px 14px;flex:1;">
      <div style="${S.label}">${label}</div>
      <div style="${S.mono}font-size:16px;font-weight:700;${color}">${value}</div>
    </div>
  `
}

// ── ALERT 1: Early Entry Signal ───────────────────────────────────
export async function sendEarlyEntryAlert(signals) {
  if (!TO_EMAIL) {
    console.warn("ALERT_EMAIL not set — skipping email")
    return { sent: false, reason: "ALERT_EMAIL not configured" }
  }

  const actionable = signals.filter(s =>
    s.status === "BUY" || s.status === "BUY_HALF"
  )
  if (actionable.length === 0) {
    return { sent: false, reason: "No actionable signals" }
  }

  const buyNow  = actionable.filter(s => s.status === "BUY")
  const buyHalf = actionable.filter(s => s.status === "BUY_HALF")

  const subject = buyNow.length > 0
    ? `⚡ ENTER NOW — ${buyNow.map(s => s.symbol).join(", ")}`
    : `🟡 ENTRY ZONE — ${buyHalf.map(s => s.symbol).join(", ")}`

  const now = new Date().toLocaleString("en-IN", {
    timeZone:  "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  })

  const signalBlock = (s) => {
    const isStrong     = s.status === "BUY"
    const borderColor  = isStrong ? "#22C55E" : "#F59E0B"
    const statusLabel  = isStrong ? "⚡ ENTER NOW" : "🟡 NEAR ENTRY"
    const statusBg     = isStrong ? "#22C55E" : "#F59E0B"
    const targetMonth  = MONTHS[(s.nextMonth?.month || 1) - 1]
    const support      = s.support?.nearest
    const currentPrice = s.price?.current
    const lotSize      = s.lot_size || 0
    const notional     = currentPrice && lotSize
      ? ((currentPrice * lotSize) / 100000).toFixed(2) + "L"
      : "—"
    const targetPrice  = currentPrice && s.nextMonth?.median_return
      ? "₹" + Math.round(
          currentPrice * (1 + s.nextMonth.median_return / 100)
        ).toLocaleString("en-IN")
      : "—"
    const slPrice = s.context?.ma50
      ? "₹" + Math.round(s.context.ma50 * 0.97).toLocaleString("en-IN") + " (3% below 10wk avg)"
      : currentPrice
      ? "₹" + Math.round(currentPrice * 0.93).toLocaleString("en-IN") + " (7% below entry)"
      : "—"

    return `
      <div style="${S.card}border-left:3px solid ${borderColor};">
        <!-- Symbol row -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
          <div>
            <div style="${S.mono}font-size:22px;font-weight:800;${S.accent}">${s.symbol}</div>
            <div style="font-size:11px;${S.dim}margin-top:2px;">
              ${s.sector || ""} · Score: ${s.signal?.score || 0}/100 · ${targetMonth} contract
            </div>
          </div>
          <div style="background:${statusBg}20;border:1px solid ${statusBg}50;border-radius:6px;padding:6px 12px;text-align:center;">
            <div style="color:${statusBg};font-weight:700;font-size:12px;${S.mono}">${statusLabel}</div>
          </div>
        </div>
        <!-- Stats row -->
        <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
          ${statBox(targetMonth + " Win Rate", (s.nextMonth?.win_rate || 0).toFixed(1) + "%", S.green)}
          ${statBox("Median Return", "+" + (s.nextMonth?.median_return || 0).toFixed(1) + "%", S.green)}
          ${statBox("Current Price", currentPrice ? "₹" + currentPrice.toLocaleString("en-IN") : "—", S.text)}
          ${statBox("Notional/lot", notional, S.soft)}
        </div>
        <!-- Support zone -->
        ${support ? `
          <div style="background:#F59E0B10;border:1px solid #F59E0B30;border-radius:6px;padding:10px;margin-bottom:12px;">
            <div style="font-size:12px;${S.amber}font-weight:600;">
              📍 Support Zone: ₹${support.price?.toLocaleString("en-IN")}
              (${support.type === "MA20"       ? "4-week average"    :
                 support.type === "MA50"       ? "10-week average"   :
                 support.type === "SWING_LOW"  ? "recent price floor" :
                 support.type})
              — ${s.support?.distancePct}% below current
            </div>
            <div style="font-size:11px;${S.soft}margin-top:4px;">
              ${isStrong ? "Price is AT this zone right now — good entry" : "Set a price alert here — enter when reached"}
            </div>
          </div>
        ` : ""}
        <!-- Action plan -->
        <div style="background:#131D30;border-radius:6px;padding:12px;">
          <div style="${S.label}margin-bottom:8px;">Your Action Plan</div>
          <table style="width:100%;border-collapse:collapse;">
            ${[
              ["Enter at",  isStrong
                ? "₹" + (currentPrice || 0).toLocaleString("en-IN") + " (now)"
                : "₹" + (support?.price || 0).toLocaleString("en-IN") + " (wait for dip)",
                isStrong ? S.green : S.amber],
              ["Stop Loss", slPrice, S.red],
              ["Target",    targetPrice + " (+" + (s.nextMonth?.median_return || 0).toFixed(1) + "%)", S.green],
              ["Contract",  s.symbol + " " + targetMonth + " Futures · Lot: " + (lotSize || 0).toLocaleString("en-IN") + " shares", S.soft],
              ["Fallback",  "Enter at market on 22nd if no dip", S.dim],
            ].map(([label, value, color]) => `
              <tr>
                <td style="padding:4px 8px 4px 0;font-size:11px;${S.dim}white-space:nowrap;width:80px;">${label}</td>
                <td style="padding:4px 0;font-size:12px;${color}font-weight:500;">${value}</td>
              </tr>
            `).join("")}
          </table>
        </div>
        <!-- Checklist warning -->
        ${s.checklist?.result === "CAUTION" ? `
          <div style="margin-top:10px;background:#F59E0B08;border:1px solid #F59E0B25;border-radius:6px;padding:8px 10px;font-size:11px;${S.amber}">
            ⚠ ${s.checklist.summary}
          </div>
        ` : ""}
        ${s.checklist?.result === "FAIL" ? `
          <div style="margin-top:10px;background:#EF444408;border:1px solid #EF444425;border-radius:6px;padding:8px 10px;font-size:11px;${S.red}">
            ✗ Checklist failed — trade with extra caution
          </div>
        ` : ""}
      </div>
    `
  }

  const html = `
    <!DOCTYPE html><html>
    <body style="${S.body}">
    <div style="${S.wrap}">
      <!-- Header -->
      <div style="${S.card}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:10px;${S.accent}letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">
              NSE F&amp;O · Early Entry Scanner
            </div>
            <div style="font-size:22px;font-weight:800;${S.text}">
              ${buyNow.length > 0 ? "Entry Signal Detected" : "Entry Zone Approaching"}
            </div>
            <div style="font-size:12px;${S.dim}margin-top:4px;">
              ${now} IST · ${actionable.length} signal${actionable.length !== 1 ? "s" : ""} found
            </div>
          </div>
          <div style="background:${buyNow.length > 0 ? "#22C55E" : "#F59E0B"}20;border:1px solid ${buyNow.length > 0 ? "#22C55E" : "#F59E0B"}40;border-radius:8px;padding:10px 16px;text-align:center;">
            <div style="color:${buyNow.length > 0 ? "#22C55E" : "#F59E0B"};font-weight:700;font-size:13px;">
              ${buyNow.length > 0 ? "ACTION NEEDED" : "SET PRICE ALERT"}
            </div>
            <div style="font-size:10px;${S.dim}margin-top:2px;">${actionable.length} stock${actionable.length !== 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>
      <!-- BUY NOW section -->
      ${buyNow.length > 0 ? `
        <div style="font-size:11px;${S.green}font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">
          ⚡ Enter Now — Price At Support
        </div>
        ${buyNow.map(signalBlock).join("")}
      ` : ""}
      <!-- BUY HALF section -->
      ${buyHalf.length > 0 ? `
        <div style="font-size:11px;${S.amber}font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:${buyNow.length > 0 ? "20px" : "0"} 0 10px;">
          🟡 Approaching Entry Zone — Set Price Alert
        </div>
        ${buyHalf.map(signalBlock).join("")}
      ` : ""}
      ${footer()}
    </div>
    </body></html>
  `

  const { data, error } = await resend.emails.send({
    from:    FROM_EMAIL,
    to:      TO_EMAIL,
    subject,
    html,
  })
  if (error) {
    console.error("Early entry email failed:", JSON.stringify(error))
    return { sent: false, error: error.message || JSON.stringify(error) }
  }
  console.log("Early entry alert sent:", data?.id)
  return { sent: true, id: data?.id, count: actionable.length }
}

// ── ALERT 2: Daily Position Update ───────────────────────────────
export async function sendPositionAlert(positions) {
  if (!TO_EMAIL) {
    return { sent: false, reason: "ALERT_EMAIL not configured" }
  }
  if (positions.length === 0) {
    return { sent: false, reason: "No positions" }
  }

  const exitNow   = positions.filter(p => p.recommendation?.action === "EXIT_NOW")
  const trailStop = positions.filter(p => p.recommendation?.action === "TRAIL_STOP")
  const timeStop  = positions.filter(p => p.recommendation?.action === "TIME_STOP")
  const holding   = positions.filter(p =>
    p.recommendation?.action === "HOLD" || p.recommendation?.action === "WATCH"
  )

  const hasAction = exitNow.length > 0 || trailStop.length > 0 || timeStop.length > 0

  const subject = exitNow.length > 0
    ? `🟢 EXIT NOW — ${exitNow.map(p => p.symbol).join(", ")}`
    : trailStop.length > 0
    ? `📊 MOVE STOP LOSS — ${trailStop.map(p => p.symbol).join(", ")}`
    : timeStop.length > 0
    ? `⏱ TIME STOP — ${timeStop.map(p => p.symbol).join(", ")}`
    : `📋 All Clear — ${positions.length} position${positions.length !== 1 ? "s" : ""} on track`

  const now = new Date().toLocaleString("en-IN", {
    timeZone:  "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  })

  const posRow = (p) => {
    const pnl      = p.pnl
    const isProfit = (pnl?.total || 0) >= 0
    const rec      = p.recommendation
    const recColor =
      rec?.action === "EXIT_NOW"   ? S.green  :
      rec?.action === "TRAIL_STOP" ? S.accent :
      rec?.action === "TIME_STOP"  ? S.amber  : S.dim

    return `
      <tr style="border-bottom:1px solid #1E2D45;">
        <td style="padding:12px 10px;">
          <div style="${S.mono}font-size:14px;font-weight:700;${S.accent}">${p.symbol}</div>
          <div style="font-size:10px;${S.dim}margin-top:2px;">
            ${p.direction} · Entry ₹${(p.entryPrice || 0).toLocaleString("en-IN")} ·
            ${p.timing?.daysInTrade || 0}d ago · ${p.timing?.daysRemaining || 0}d left
          </div>
        </td>
        <td style="padding:12px 10px;text-align:right;">
          ${pnl ? `
            <div style="${S.mono}font-size:14px;font-weight:700;${isProfit ? S.green : S.red}">
              ${isProfit ? "+" : "-"}₹${Math.abs(pnl.total).toLocaleString("en-IN")}
            </div>
            <div style="font-size:11px;${isProfit ? S.green : S.red}margin-top:2px;">
              ${isProfit ? "+" : ""}${pnl.returnPct}%
            </div>
          ` : `<div style="font-size:11px;${S.dim}">No live data</div>`}
        </td>
        <td style="padding:12px 10px;text-align:right;">
          ${pnl ? `
            <div style="font-size:11px;${S.soft}">${pnl.medianCapture}% of median</div>
            <div style="font-size:10px;${S.dim}margin-top:2px;">₹${(p.livePrice || 0).toLocaleString("en-IN")} live</div>
          ` : "—"}
        </td>
        <td style="padding:12px 10px;text-align:right;min-width:140px;">
          ${rec ? `
            <div style="font-size:11px;font-weight:600;${recColor}">${rec.title}</div>
            <div style="font-size:10px;${S.dim}margin-top:3px;max-width:160px;text-align:right;">${rec.reason}</div>
          ` : "—"}
        </td>
      </tr>
    `
  }

  const section = (title, color, icon, items) => {
    if (items.length === 0) return ""
    return `
      <div style="margin-bottom:20px;">
        <div style="background:${color}12;border-left:3px solid ${color};border-radius:0 6px 6px 0;padding:8px 14px;margin-bottom:10px;">
          <span style="color:${color};font-weight:700;font-size:12px;">${icon} ${title}</span>
        </div>
        <div style="${S.card}padding:0;overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#131D30;">
                ${["Symbol", "P&amp;L", "Progress", "Action"].map(h => `
                  <th style="padding:8px 10px;text-align:${h === "Symbol" ? "left" : "right"};font-size:10px;${S.dim}text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">${h}</th>
                `).join("")}
              </tr>
            </thead>
            <tbody>${items.map(posRow).join("")}</tbody>
          </table>
        </div>
      </div>
    `
  }

  const html = `
    <!DOCTYPE html><html>
    <body style="${S.body}">
    <div style="${S.wrap}">
      <!-- Header -->
      <div style="${S.card}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:10px;${S.accent}letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">
              NSE F&amp;O · Daily Position Monitor
            </div>
            <div style="font-size:22px;font-weight:800;${S.text}">Market Close Report</div>
            <div style="font-size:12px;${S.dim}margin-top:4px;">
              ${now} IST · ${positions.length} open position${positions.length !== 1 ? "s" : ""}
            </div>
          </div>
          <div style="background:${hasAction ? "#22C55E" : "#4D9FFF"}20;border:1px solid ${hasAction ? "#22C55E" : "#4D9FFF"}40;border-radius:8px;padding:10px 16px;text-align:center;">
            <div style="color:${hasAction ? "#22C55E" : "#4D9FFF"};font-weight:700;font-size:13px;">
              ${hasAction ? "ACTION NEEDED" : "ALL CLEAR"}
            </div>
          </div>
        </div>
      </div>
      ${section("Exit Now",            "#22C55E", "🟢", exitNow)}
      ${section("Move Stop Loss",      "#4D9FFF", "📊", trailStop)}
      ${section("Time Stop Warning",   "#F59E0B", "⏱",  timeStop)}
      ${section("Holding — On Track",  "#64748B", "📋", holding)}
      ${footer()}
    </div>
    </body></html>
  `

  const { data, error } = await resend.emails.send({
    from:    FROM_EMAIL,
    to:      TO_EMAIL,
    subject,
    html,
  })
  if (error) {
    console.error("Position email failed:", JSON.stringify(error))
    return { sent: false, error: error.message || JSON.stringify(error) }
  }
  console.log("Position alert sent:", data?.id)
  return { sent: true, id: data?.id }
}
