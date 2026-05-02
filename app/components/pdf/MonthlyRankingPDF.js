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

function getSignalColor(winRate) {
  if (winRate >= 80)  return "#4ADE80"
  if (winRate >= 65)  return "#FBBF24"
  if (winRate >= 50)  return "#94A3B8"
  return "#F87171"
}

const MONTH_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
]

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
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1E2A3E",
  },
  headerLeft: { flex: 1 },
  labelText: {
    fontSize: 8,
    color: "#64748B",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  monthName: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: "#4D9FFF",
    marginBottom: 4,
  },
  subtitleText: { fontSize: 8, color: "#94A3B8" },
  headerRight: { alignItems: "flex-end" },
  dashboardLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#E2E8F0",
    marginBottom: 3,
  },
  craftedText: { fontSize: 9, color: "#4D9FFF", marginBottom: 3 },
  dateText: { fontSize: 8, color: "#64748B" },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#E2E8F0",
    marginBottom: 7,
    marginTop: 14,
  },
  sectionTitleRed: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#F87171",
    marginBottom: 7,
    marginTop: 14,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#131D30",
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 4,
    marginBottom: 1,
  },
  tableHeaderRed: {
    flexDirection: "row",
    backgroundColor: "#1C0A0A",
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 4,
    marginBottom: 1,
  },
  tableHeaderCell: {
    fontSize: 6,
    color: "#64748B",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#0E1525",
  },
  tableRowAlt: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#0E1525",
    backgroundColor: "#0E1525",
  },
  disclaimerText: { fontSize: 7, color: "#64748B", marginTop: 10 },
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

// ── Column definitions (shared between top and avoid tables) ─────────────────

const COLS = [
  { label: "#",        flex: 0.35 },
  { label: "Symbol",   flex: 1.4  },
  { label: "Sector",   flex: 1.6  },
  { label: "Win Rate", flex: 1,    right: true },
  { label: "Avg Ret",  flex: 0.9,  right: true },
  { label: "Best",     flex: 0.8,  right: true },
  { label: "Worst",    flex: 0.8,  right: true },
  { label: "Lot",      flex: 0.8,  right: true },
  { label: "Signal",   flex: 1.2,  right: true },
]

// ── Main PDF component ────────────────────────────────────────────────────────

export default function MonthlyRankingPDF({ month, data }) {
  const topStocks   = (data?.top_stocks   || []).slice(0, 20)
  const avoidStocks = (data?.avoid_stocks || []).slice(0, 8)
  const total       = data?.total_stocks  || 0
  const lastUpdated = data?.last_updated  || ""
  const monthName   = MONTH_FULL[(month || 1) - 1]
  const today       = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })

  const renderRow = (st, i, isAvoid = false) => {
    const wr       = st.win_rate || 0
    const signal   = getSignalLabel(wr)
    const sigColor = isAvoid ? "#F87171" : getSignalColor(wr)
    const rowSt    = i % 2 === 0 ? s.tableRow : s.tableRowAlt

    return (
      <View key={st.symbol} style={rowSt}>
        <Text style={{ flex: 0.35, fontSize: 7, color: "#64748B" }}>{i + 1}</Text>
        <Text style={{ flex: 1.4, fontSize: 7, fontFamily: "Helvetica-Bold", color: isAvoid ? "#F87171" : "#4D9FFF" }}>
          {st.symbol}
        </Text>
        <Text style={{ flex: 1.6, fontSize: 7, color: "#94A3B8" }}>{st.sector || "—"}</Text>
        <Text style={{ flex: 1, fontSize: 7, textAlign: "right", color: wr >= 80 ? "#4ADE80" : wr >= 60 ? "#FBBF24" : "#F87171" }}>
          {wr?.toFixed(1)}%
        </Text>
        <Text style={{ flex: 0.9, fontSize: 7, textAlign: "right", color: st.avg_return >= 0 ? "#4ADE80" : "#F87171" }}>
          {st.avg_return >= 0 ? "+" : ""}{st.avg_return?.toFixed(2)}%
        </Text>
        <Text style={{ flex: 0.8, fontSize: 7, textAlign: "right", color: "#4ADE80" }}>
          +{st.best?.toFixed(1)}%
        </Text>
        <Text style={{ flex: 0.8, fontSize: 7, textAlign: "right", color: "#F87171" }}>
          {st.worst?.toFixed(1)}%
        </Text>
        <Text style={{ flex: 0.8, fontSize: 7, textAlign: "right", color: "#64748B" }}>
          {st.lot_size?.toLocaleString("en-IN") || "—"}
        </Text>
        <Text style={{ flex: 1.2, fontSize: 7, textAlign: "right", color: sigColor }}>
          {signal}
        </Text>
      </View>
    )
  }

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* Header */}
        <View style={s.headerBar}>
          <View style={s.headerLeft}>
            <Text style={s.labelText}>Monthly F&O Rankings</Text>
            <Text style={s.monthName}>{monthName}</Text>
            <Text style={s.subtitleText}>
              {total} stocks scanned · Real NSE data{lastUpdated ? ` · Updated ${lastUpdated}` : ""}
            </Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.dashboardLabel}>NSE F&O Dashboard</Text>
            <Text style={s.craftedText}>Crafted by Khilan Patel</Text>
            <Text style={s.dateText}>{today}</Text>
          </View>
        </View>

        {/* Top Picks Table */}
        <Text style={s.sectionTitle}>Top Picks — {monthName}</Text>
        <View style={s.tableHeader}>
          {COLS.map((col, i) => (
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
        {topStocks.map((st, i) => renderRow(st, i, false))}

        {/* Avoid Stocks Table */}
        {avoidStocks.length > 0 && (
          <>
            <Text style={s.sectionTitleRed}>Avoid — {monthName}</Text>
            <View style={s.tableHeaderRed}>
              {COLS.map((col, i) => (
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
            {avoidStocks.map((st, i) => renderRow(st, i, true))}
          </>
        )}

        {/* Disclaimer */}
        <Text style={s.disclaimerText}>
          Data: NSE via GOOGLEFINANCE · Historical seasonality only · Not SEBI-registered advice · Crafted by Khilan Patel
        </Text>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerLeft}>Data: NSE via GOOGLEFINANCE · Not SEBI-registered advice</Text>
          <Text style={s.footerRight}>Crafted by Khilan Patel</Text>
        </View>

      </Page>
    </Document>
  )
}
