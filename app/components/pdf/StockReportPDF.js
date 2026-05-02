import React from "react"
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer"

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSignalLabel(winRate) {
  if (winRate === 100) return "PERFECT"
  if (winRate >= 93)   return "EXCELLENT"
  if (winRate >= 80)   return "BULLISH"
  if (winRate >= 65)   return "MILD BULL"
  if (winRate >= 50)   return "NEUTRAL"
  if (winRate >= 40)   return "WEAK"
  return "AVOID"
}

function getMonthCardColors(winRate) {
  const signal = getSignalLabel(winRate)
  if (signal === "PERFECT" || signal === "EXCELLENT")
    return { bg: "#052E16", border: "#14532D", textColor: "#4ADE80" }
  if (signal === "BULLISH" || signal === "MILD BULL")
    return { bg: "#0C2340", border: "#1E3A5F", textColor: "#60A5FA" }
  if (signal === "NEUTRAL")
    return { bg: "#111827", border: "#1E2D45", textColor: "#94A3B8" }
  return { bg: "#1C0A0A", border: "#3D1515", textColor: "#F87171" }
}

function pct(n) {
  if (n === null || n === undefined) return "—"
  const sign = n >= 0 ? "+" : ""
  return `${sign}${n.toFixed(2)}%`
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    backgroundColor: "#0A0F1E",
    padding: 32,
    fontFamily: "Helvetica",
  },
  headerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1E2A3E",
  },
  headerLeft: { flex: 1 },
  symbolText: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    color: "#4D9FFF",
    marginBottom: 4,
  },
  sectorText: { fontSize: 9, color: "#64748B", letterSpacing: 1 },
  headerRight: { alignItems: "flex-end" },
  reportTitle: { fontSize: 10, color: "#64748B", letterSpacing: 0.5, marginBottom: 3 },
  dateText: { fontSize: 9, color: "#94A3B8", marginBottom: 3 },
  craftedText: { fontSize: 9, color: "#4D9FFF" },
  statsRow: { flexDirection: "row", gap: 6, marginBottom: 20 },
  statBox: {
    flex: 1,
    backgroundColor: "#131D30",
    borderRadius: 5,
    padding: 9,
    borderWidth: 1,
    borderColor: "#1E2A3E",
  },
  statLabel: {
    fontSize: 6,
    color: "#64748B",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#E2E8F0",
  },
  cardsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginBottom: 20,
  },
  monthCard: {
    width: "31.5%",
    borderRadius: 5,
    padding: 7,
    borderWidth: 1,
  },
  cardMonth: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#94A3B8",
    marginBottom: 3,
  },
  cardWinRate: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginBottom: 1,
  },
  cardYears: { fontSize: 6, color: "#64748B", marginBottom: 3 },
  cardAvgReturn: { fontSize: 8, marginBottom: 3 },
  cardSignal: { fontSize: 7, letterSpacing: 0.4, marginBottom: 3 },
  cardBestWorst: { fontSize: 6, color: "#94A3B8" },
  currentLabel: { fontSize: 6, color: "#4D9FFF", marginTop: 2 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#E2E8F0",
    marginBottom: 8,
    marginTop: 14,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#131D30",
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 1,
  },
  tableHeaderCell: {
    fontSize: 7,
    color: "#64748B",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#0E1525",
  },
  tableRowAlt: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#0E1525",
    backgroundColor: "#0C1524",
  },
  disclaimerBox: {
    backgroundColor: "#131D30",
    borderRadius: 5,
    padding: 12,
    borderWidth: 1,
    borderColor: "#1E2A3E",
    marginTop: 14,
  },
  disclaimerText: { fontSize: 8, color: "#64748B", lineHeight: 1.5 },
  disclaimerAuthor: { fontSize: 8, color: "#4D9FFF", textAlign: "right", marginTop: 6 },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 32,
    right: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#1E2A3E",
    paddingTop: 7,
  },
  footerLeft: { fontSize: 7, color: "#64748B" },
  footerRight: { fontSize: 7, color: "#4D9FFF" },
})

// ── Footer (fixed on every page) ──────────────────────────────────────────────

function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerLeft}>Data: NSE via GOOGLEFINANCE · Not SEBI-registered advice</Text>
      <Text style={s.footerRight}>Crafted by Khilan Patel</Text>
    </View>
  )
}

// ── Main PDF component ────────────────────────────────────────────────────────

export default function StockReportPDF({ data }) {
  const symbol      = data?.symbol || "STOCK"
  const sector      = data?.sector || ""
  const lotSize     = data?.lot_size || 0
  const prices      = data?.prices || []
  const seasonality = data?.seasonality || []

  const firstClose  = prices[0]?.close
  const lastClose   = prices[prices.length - 1]?.close
  const totalReturn = firstClose && lastClose
    ? ((lastClose - firstClose) / firstClose * 100).toFixed(1)
    : null

  const bestMonth  = [...seasonality].sort((a, b) => b.win_rate - a.win_rate)[0]
  const worstMonth = [...seasonality].sort((a, b) => a.win_rate - b.win_rate)[0]

  const today          = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  const currentMonthIdx = new Date().getMonth()

  // Recent 36 months for page 2
  const recent36 = [...prices].slice(-36).reverse()

  return (
    <Document>

      {/* ── PAGE 1: Overview ─────────────────────────────────────────────── */}
      <Page size="A4" style={s.page}>

        {/* Header */}
        <View style={s.headerBar}>
          <View style={s.headerLeft}>
            <Text style={s.symbolText}>{symbol}</Text>
            <Text style={s.sectorText}>{sector.toUpperCase() || "NSE F&O"}</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.reportTitle}>NSE F&O SEASONALITY REPORT</Text>
            <Text style={s.dateText}>Generated: {today}</Text>
            <Text style={s.craftedText}>Crafted by Khilan Patel</Text>
          </View>
        </View>

        {/* 5 Stat Boxes */}
        <View style={s.statsRow}>
          {[
            {
              label: "Total Return Since 2009",
              value: totalReturn !== null
                ? `${parseFloat(totalReturn) >= 0 ? "+" : ""}${totalReturn}%`
                : "—",
            },
            { label: "Latest Close", value: lastClose ? `Rs.${lastClose.toLocaleString("en-IN")}` : "—" },
            { label: "Lot Size",     value: lotSize ? lotSize.toLocaleString("en-IN") : "—" },
            { label: "Best Month",   value: bestMonth?.month || "—" },
            { label: "Worst Month",  value: worstMonth?.month || "—" },
          ].map((st, i) => (
            <View key={i} style={s.statBox}>
              <Text style={s.statLabel}>{st.label}</Text>
              <Text style={s.statValue}>{st.value}</Text>
            </View>
          ))}
        </View>

        {/* 12 Monthly Cards — 3×4 grid */}
        <View style={s.cardsGrid}>
          {seasonality.map((ms, i) => {
            const colors     = getMonthCardColors(ms.win_rate)
            const signal     = getSignalLabel(ms.win_rate)
            const isCurrent  = i === currentMonthIdx
            const totalYears = ms.data_points
              || (ms.win_rate > 0 ? Math.round(ms.positive_years / (ms.win_rate / 100)) : 0)

            return (
              <View
                key={i}
                style={[
                  s.monthCard,
                  {
                    backgroundColor: isCurrent ? "#0A1628" : colors.bg,
                    borderColor:     isCurrent ? "#4D9FFF" : colors.border,
                  },
                ]}
              >
                <Text style={s.cardMonth}>{MONTHS[i]}</Text>
                <Text style={[s.cardWinRate, { color: colors.textColor }]}>
                  {ms.win_rate?.toFixed(0)}%
                </Text>
                <Text style={s.cardYears}>
                  ({ms.positive_years || 0}/{totalYears} positive years)
                </Text>
                <Text style={[s.cardAvgReturn, { color: ms.avg_return >= 0 ? "#4ADE80" : "#F87171" }]}>
                  {pct(ms.avg_return)} avg
                </Text>
                <Text style={[s.cardSignal, { color: colors.textColor }]}>{signal}</Text>
                <Text style={s.cardBestWorst}>
                  Best: {pct(ms.best)} | Worst: {pct(ms.worst)}
                </Text>
                {isCurrent && <Text style={s.currentLabel}>← Current</Text>}
              </View>
            )
          })}
        </View>

        <Footer />
      </Page>

      {/* ── PAGE 2: Detailed Analysis ─────────────────────────────────────── */}
      <Page size="A4" style={s.page}>

        <Text style={[s.symbolText, { fontSize: 16, marginBottom: 4 }]}>
          {symbol} — Detailed Analysis
        </Text>

        {/* F&O Strategy Table */}
        <Text style={s.sectionTitle}>F&O Strategy by Month</Text>
        <View style={s.tableHeader}>
          {[
            { label: "Month",     flex: 1.2 },
            { label: "Bias",      flex: 1.2 },
            { label: "Win Rate",  flex: 1,   right: true },
            { label: "Avg Ret",   flex: 1,   right: true },
            { label: "Best",      flex: 0.9, right: true },
            { label: "Worst",     flex: 0.9, right: true },
            { label: "Pos/Total", flex: 1,   right: true },
          ].map((col, i) => (
            <Text
              key={i}
              style={[
                s.tableHeaderCell,
                { flex: col.flex, textAlign: col.right ? "right" : "left" },
              ]}
            >
              {col.label}
            </Text>
          ))}
        </View>

        {seasonality.map((ms, i) => {
          const wr        = ms.win_rate
          const bias      = wr >= 80 ? "LONG" : wr >= 65 ? "MILD LONG" : wr >= 50 ? "NEUTRAL" : "AVOID"
          const biasColor = wr >= 80 ? "#4ADE80" : wr >= 65 ? "#FBBF24" : wr >= 50 ? "#94A3B8" : "#F87171"
          const totalYrs  = ms.data_points
            || (ms.win_rate > 0 ? Math.round(ms.positive_years / (ms.win_rate / 100)) : 0)
          const rowSt     = i % 2 === 0 ? s.tableRow : s.tableRowAlt

          return (
            <View key={i} style={rowSt}>
              <Text style={{ flex: 1.2, fontSize: 8, color: "#E2E8F0" }}>{MONTHS[i]}</Text>
              <Text style={{ flex: 1.2, fontSize: 8, color: biasColor }}>{bias}</Text>
              <Text style={{ flex: 1, fontSize: 8, textAlign: "right", color: wr >= 80 ? "#4ADE80" : wr >= 60 ? "#FBBF24" : "#F87171" }}>
                {wr?.toFixed(1)}%
              </Text>
              <Text style={{ flex: 1, fontSize: 8, textAlign: "right", color: ms.avg_return >= 0 ? "#4ADE80" : "#F87171" }}>
                {pct(ms.avg_return)}
              </Text>
              <Text style={{ flex: 0.9, fontSize: 8, textAlign: "right", color: "#4ADE80" }}>
                {pct(ms.best)}
              </Text>
              <Text style={{ flex: 0.9, fontSize: 8, textAlign: "right", color: "#F87171" }}>
                {pct(ms.worst)}
              </Text>
              <Text style={{ flex: 1, fontSize: 8, textAlign: "right", color: "#94A3B8" }}>
                {ms.positive_years || 0}/{totalYrs}
              </Text>
            </View>
          )
        })}

        {/* Recent 36 Months */}
        <Text style={s.sectionTitle}>Recent 36 Monthly Returns</Text>
        <View style={s.tableHeader}>
          {[
            { label: "Date",      flex: 1.5 },
            { label: "Close Rs.", flex: 1,   right: true },
            { label: "Return %",  flex: 1,   right: true },
            { label: "Signal",    flex: 1.2, right: true },
          ].map((col, i) => (
            <Text
              key={i}
              style={[
                s.tableHeaderCell,
                { flex: col.flex, textAlign: col.right ? "right" : "left" },
              ]}
            >
              {col.label}
            </Text>
          ))}
        </View>

        {recent36.map((p, i) => {
          const mIdx     = p.date ? parseInt(p.date.split("-")[1]) - 1 : 0
          const mSeas    = seasonality[mIdx]
          const signal   = mSeas ? getSignalLabel(mSeas.win_rate) : "—"
          const rowSt    = i % 2 === 0 ? s.tableRow : s.tableRowAlt
          const retColor = p.return_pct === null || p.return_pct === undefined
            ? "#94A3B8"
            : p.return_pct >= 0 ? "#4ADE80" : "#F87171"

          return (
            <View key={p.date || i} style={rowSt}>
              <Text style={{ flex: 1.5, fontSize: 8, color: "#94A3B8" }}>{p.date}</Text>
              <Text style={{ flex: 1, fontSize: 8, textAlign: "right", color: "#E2E8F0" }}>
                Rs.{p.close?.toLocaleString("en-IN")}
              </Text>
              <Text style={{ flex: 1, fontSize: 8, textAlign: "right", color: retColor }}>
                {p.return_pct !== null && p.return_pct !== undefined ? pct(p.return_pct) : "—"}
              </Text>
              <Text style={{ flex: 1.2, fontSize: 8, textAlign: "right", color: "#94A3B8" }}>
                {signal}
              </Text>
            </View>
          )
        })}

        {/* Disclaimer */}
        <View style={s.disclaimerBox}>
          <Text style={s.disclaimerText}>
            This report is generated from real NSE historical data via GOOGLEFINANCE.
            Seasonality analysis shows historical patterns only and does not guarantee future
            performance. F&O trading involves significant risk of loss. This is not
            SEBI-registered investment advice. Past performance is not indicative of future
            results. Please do your own research before making investment decisions.
          </Text>
          <Text style={s.disclaimerAuthor}>Crafted by Khilan Patel</Text>
        </View>

        <Footer />
      </Page>

    </Document>
  )
}
