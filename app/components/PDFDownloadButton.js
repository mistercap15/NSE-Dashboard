"use client"
import { useState } from "react"

const MONTH_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
]

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

// ── Stock PDF Button ──────────────────────────────────────────────────────────

export function StockPDFButton({ data }) {
  const [state,    setState]    = useState("idle") // idle | loading | ready
  const [Renderer, setRenderer] = useState(null)
  const [PDFComp,  setPDFComp]  = useState(null)

  const handleClick = async () => {
    if (state !== "idle") return
    setState("loading")
    try {
      const [renderer, comp] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./pdf/StockReportPDF"),
      ])
      setRenderer(renderer)
      setPDFComp(() => comp.default)
      setState("ready")
    } catch (e) {
      console.error("PDF load error:", e)
      setState("idle")
    }
  }

  if (state === "ready" && Renderer && PDFComp) {
    const { PDFDownloadLink } = Renderer
    const symbol   = data?.symbol || "STOCK"
    const filename = `${symbol}_Seasonality_Report_${todayStr()}.pdf`
    return (
      <PDFDownloadLink document={<PDFComp data={data} />} fileName={filename}>
        {({ loading: pdfLoading }) => (
          <span className="inline-flex items-center gap-2 border border-accent/40 bg-accent/10 text-accent font-mono text-sm px-4 py-2 rounded cursor-pointer hover:bg-accent/20 transition-colors select-none">
            {pdfLoading ? (
              <>
                <span className="w-3.5 h-3.5 border border-accent border-t-transparent rounded-full animate-spin" />
                Preparing...
              </>
            ) : "↓ Download"}
          </span>
        )}
      </PDFDownloadLink>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={state === "loading"}
      className={`inline-flex items-center gap-2 font-mono text-sm px-4 py-2 rounded border transition-colors ${
        state === "loading"
          ? "border-border text-dim cursor-not-allowed"
          : "border-border text-dim hover:text-text hover:border-muted"
      }`}
    >
      {state === "loading" ? (
        <>
          <span className="w-3.5 h-3.5 border border-dim border-t-transparent rounded-full animate-spin" />
          Preparing...
        </>
      ) : "↓ Download PDF Report"}
    </button>
  )
}

// ── Rankings PDF Button ───────────────────────────────────────────────────────

export function RankingsPDFButton({ month, data }) {
  const [state,    setState]    = useState("idle")
  const [Renderer, setRenderer] = useState(null)
  const [PDFComp,  setPDFComp]  = useState(null)

  const handleClick = async () => {
    if (state !== "idle") return
    setState("loading")
    try {
      const [renderer, comp] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./pdf/MonthlyRankingPDF"),
      ])
      setRenderer(renderer)
      setPDFComp(() => comp.default)
      setState("ready")
    } catch (e) {
      console.error("PDF load error:", e)
      setState("idle")
    }
  }

  if (state === "ready" && Renderer && PDFComp) {
    const { PDFDownloadLink } = Renderer
    const monthName = MONTH_FULL[(month || 1) - 1]
    const year      = new Date().getFullYear()
    const filename  = `NSE_Rankings_${monthName}_${year}.pdf`
    return (
      <PDFDownloadLink document={<PDFComp month={month} data={data} />} fileName={filename}>
        {({ loading: pdfLoading }) => (
          <span className="inline-flex items-center gap-2 border border-accent/40 bg-accent/10 text-accent font-mono text-sm px-4 py-2 rounded cursor-pointer hover:bg-accent/20 transition-colors select-none">
            {pdfLoading ? (
              <>
                <span className="w-3.5 h-3.5 border border-accent border-t-transparent rounded-full animate-spin" />
                Preparing...
              </>
            ) : "↓ Download"}
          </span>
        )}
      </PDFDownloadLink>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={state === "loading"}
      className={`inline-flex items-center gap-2 font-mono text-sm px-4 py-2 rounded border transition-colors ${
        state === "loading"
          ? "border-border text-dim cursor-not-allowed"
          : "border-border text-dim hover:text-text hover:border-muted"
      }`}
    >
      {state === "loading" ? (
        <>
          <span className="w-3.5 h-3.5 border border-dim border-t-transparent rounded-full animate-spin" />
          Preparing...
        </>
      ) : "↓ Download PDF Report"}
    </button>
  )
}
