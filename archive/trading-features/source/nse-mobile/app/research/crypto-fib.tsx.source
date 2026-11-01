import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Badge, Card, ErrorState, KV, Label, StatCard, StatRow } from "@/components/ui";
import { SkeletonCard, SkeletonStatRow } from "@/components/Skeleton";
import { BotLiveState } from "@/components/BotLiveState";
import { useCryptoFibSignal } from "@/lib/queries";
import { DASH, num } from "@/lib/format";
import { Radius, Spacing, Type, useColors } from "@/lib/theme";

// ─────────────────────────────────────────────────────────────────────────────
// Crypto Fib bot — the same strategy as the Nifty Fib screen, on Delta perps.
//
// Three things it says that the Nifty screen does not, all deliberate:
//   • the NETWORK, because testnet and mainnet must never be confused
//   • the symbol, since the signal serves BTC and ETH and the bot trades one
//   • the stop as a PERCENTAGE, which is what makes the 2x leverage cap legible
//
// No connection banner: Delta's candle endpoint is public, so nothing here needs
// a broker credential.
// ─────────────────────────────────────────────────────────────────────────────

const px = (n: number | null | undefined, d = 2) => num(n, d);
const SYMBOLS = ["ETH", "BTC"] as const;

function barLabel(iso: string | null | undefined) {
  if (typeof iso !== "string" || iso.length < 16) return null;
  return { time: `${iso.slice(11, 16)} UTC`, date: iso.slice(0, 10) };
}

export default function CryptoFibScreen() {
  const c = useColors();
  const [symbol, setSymbol] = useState<string>("ETH");
  const { data, isLoading, isRefetching, error, refetch } = useCryptoFibSignal(symbol);

  const signal = data?.signal ?? null;
  const armed = signal?.entryValid === true;
  const testnet = data?.network !== "mainnet";
  const bar = barLabel(signal?.asOf);

  const riskPct =
    signal?.fibEntry != null && signal?.stopPrice != null && signal.fibEntry !== 0
      ? ((signal.fibEntry - signal.stopPrice) / signal.fibEntry) * 100
      : null;

  const tint = !signal ? c.dim : armed ? c.green : c.amber;
  const label = !signal ? "NO SIGNAL" : armed ? "READY TO BUY" : "WAITING FOR A SETUP";
  const note = !signal
    ? data?.error ?? "Nothing to act on yet."
    : armed
      ? "A buy order should be waiting at this price."
      : "No order should be waiting right now.";

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: Spacing.xxl }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
    >
      {/* flexWrap and a shrinkable Label: this row is an uppercase, letter-spaced
          Label next to a Badge, and at 11px with letterSpacing 1.2 the label
          alone can exceed a phone's width. Without wrapping, the badge is
          pushed clean off the card. */}
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: Spacing.xs }}>
        <Label style={{ flexShrink: 1 }} numberOfLines={1}>Delta perps · hourly</Label>
        <View style={{ flex: 1, minWidth: 0 }} />
        <Badge text={testnet ? "TESTNET" : "MAINNET · REAL"} color={testnet ? c.amber : c.red} small />
      </View>

      {/* Symbol switch */}
      <View style={{ flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.sm }}>
        {SYMBOLS.map((s) => (
          <Pressable key={s} onPress={() => setSymbol(s)} style={{ flex: 1 }}>
            <Card
              tint={symbol === s ? c.accent : undefined}
              style={{ padding: Spacing.sm, alignItems: "center" }}
            >
              <Text style={{ color: symbol === s ? c.accent : c.dim, fontWeight: "800", fontSize: 13 }}>
                {s}
              </Text>
            </Card>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
          <SkeletonCard height={120} />
          <SkeletonStatRow count={3} />
        </View>
      ) : error ? (
        <View style={{ marginTop: Spacing.md }}>
          <ErrorState message={(error as Error).message} onRetry={refetch} />
        </View>
      ) : (
        <>
          {/* The Delta bot's own state. It shares no contract with the Nifty
              bots, so there is no priority pair here — just whether it is up,
              paused, halted or holding. */}
          <BotLiveState focus="crypto" />

          <Card tint={tint} stripe={tint} style={{ padding: Spacing.md, marginTop: Spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: tint, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 }}>
                  {label}
                </Text>
                <Text style={{ color: c.dim, fontSize: 11, marginTop: 3, lineHeight: 15 }}>{note}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Label style={{ fontSize: 9 }}>As of</Label>
                <Text style={{ color: c.text, fontSize: 14, fontWeight: "800", ...Type.numeric }}>
                  {bar?.time ?? DASH}
                </Text>
                {bar ? <Text style={{ color: c.dim, fontSize: 9.5, ...Type.numeric }}>{bar.date}</Text> : null}
              </View>
            </View>
            {signal?.reason || data?.error ? (
              <Text style={{ color: c.soft, fontSize: 11.5, marginTop: Spacing.sm, lineHeight: 17 }}>
                {signal?.reason ?? data?.error}
              </Text>
            ) : null}
          </Card>

          <Card
            tint={armed ? c.accent : undefined}
            style={{ padding: Spacing.md, marginTop: Spacing.sm }}
          >
            <Label style={{ fontSize: 9.5 }}>Fib entry — limit buy</Label>
            <Text
              style={{
                color: armed ? c.accent : c.text, fontSize: 30, fontWeight: "800",
                letterSpacing: -1, marginTop: 4, ...Type.numeric,
              }}
            >
              {px(signal?.fibEntry)}
            </Text>
            <Text style={{ color: c.dim, fontSize: 10.5, marginTop: 2 }}>
              {data?.symbol ?? DASH} · 1 lot = {data?.lotSize ?? DASH} {symbol}
            </Text>
          </Card>

          <View style={{ marginTop: Spacing.sm }}>
            <StatRow>
              <StatCard
                label="Stop" value={px(signal?.stopPrice)}
                sub={riskPct != null ? `${riskPct.toFixed(2)}% below` : undefined}
                color={c.red}
              />
              <StatCard label="Target" value={px(signal?.targetPrice)} sub="swing high" color={c.green} />
              <StatCard
                label="Risk at 2×"
                value={riskPct != null ? `${(riskPct * 2).toFixed(1)}%` : DASH}
                sub="of margin"
                color={riskPct != null && riskPct * 2 > 25 ? c.red : undefined}
              />
            </StatRow>
          </View>

          <Card style={{ padding: Spacing.md, marginTop: Spacing.sm }}>
            <Label>The swing behind it</Label>
            <View style={{ height: Spacing.xs }} />
            <KV k="Swing high (target)" v={px(signal?.swingHigh)} />
            <KV k="Swing low" v={px(signal?.swingLow)} />
            <KV k="ATR (14)" v={px(signal?.atr)} />
            <KV k="Last close" v={px(signal?.lastClose)} />
            <KV
              k="Reward : risk"
              v={signal?.rewardRiskRatio != null ? `${num(signal.rewardRiskRatio, 2)}×` : null}
            />
          </Card>

          <View style={{ marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md,
                         borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
            <Text style={{ color: c.dim, fontSize: 10.5, lineHeight: 16 }}>
              The same engine as the Nifty Fib bot, not a second copy. The buy is a waiting limit order, so it
              fills at that price or better, or not at all. Leverage is capped at 2× in code — a ~2%
              stop at 50× is the entire margin, so the position would liquidate before reaching the
              stop it was given.
              {data?.barsUsed ? ` Computed from ${data.barsUsed} closed hourly bars.` : ""}
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}
