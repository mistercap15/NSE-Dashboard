import React from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { Badge, Button, Card, ErrorState, KV, Label, StatCard, StatRow } from "@/components/ui";
import { SkeletonCard, SkeletonStatRow } from "@/components/Skeleton";
import { ApiError } from "@/lib/client";
import { BotLiveState } from "@/components/BotLiveState";
import { useBotSync, useBotTokenStatus, useFibSignal, useUpstoxStatus } from "@/lib/queries";
import { useUpstoxConnect } from "@/lib/useUpstoxConnect";
import { DASH, num } from "@/lib/format";
import { Radius, Spacing, Type, useColors, type AppColors } from "@/lib/theme";
import type { FibSignal } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Fib Bot — the Nifty futures monitor, mirroring the web's /fib screen.
//
// Presentation only. Every number here arrives from GET /api/fib/signal; the
// app computes none of them, which is why the two clients can never disagree
// about what the bot would do.
//
// Watch-only: nothing is traded from this screen, and there is no order code in
// this app at all.
// ─────────────────────────────────────────────────────────────────────────────

/** Display formatting only — index levels are quoted to 2dp. */
const px = (n: number | null | undefined) => num(n, 2);

/**
 * Bar timestamps arrive as "2026-08-18T15:15:00+05:30". The offset is part of
 * the string, so slicing shows IST regardless of the phone's timezone — parsing
 * to a Date and formatting locally would quietly re-label a 15:15 IST bar for a
 * traveller, which is the kind of wrongness a trading screen cannot afford.
 */
function barLabel(iso: string | null | undefined): { time: string; date: string } | null {
  if (typeof iso !== "string" || iso.length < 16) return null;
  return { time: iso.slice(11, 16), date: iso.slice(0, 10) };
}

type State = "armed" | "aside" | "unavailable";

function stateOf(signal: FibSignal | null, tokenValid: boolean): State {
  if (!tokenValid || !signal) return "unavailable";
  return signal.entryValid ? "armed" : "aside";
}

function stateTone(c: AppColors, state: State): { tint: string; label: string; note: string } {
  switch (state) {
    case "armed":
      return { tint: c.green, label: "READY TO BUY", note: "A buy order should be waiting at this price." };
    case "aside":
      return { tint: c.amber, label: "WAITING FOR A SETUP", note: "No order should be waiting right now." };
    default:
      return { tint: c.dim, label: "NO SIGNAL", note: "Nothing to act on yet." };
  }
}

/**
 * Push the order-capable token to the droplet, mirroring the web's /fib panel.
 *
 * Two sequential actions, so only ever one button: log in, then sync. Showing a
 * login you don't need beside a sync you can't do is noise, and on a phone the
 * space matters more.
 *
 * `oauthLinked` is the deciding field, NOT `connected` — market data comes from
 * the backend's analytics token, so `connected` is true whether or not anyone
 * has personally logged in, and using it here would hide the login forever.
 */
function BotTokenCard() {
  const c = useColors();
  const { data: status } = useUpstoxStatus();
  const { data: bot } = useBotTokenStatus();
  const { connect, connecting } = useUpstoxConnect();
  const sync = useBotSync();

  const linked = status?.oauthLinked;
  // Read from the DROPLET, not from this device. Syncing on the dashboard shows
  // up here without the app ever having logged in — which is the whole point:
  // the bot only needs one live token, not one per client.
  const synced = bot?.present === true && !bot?.expired;
  const until =
    typeof bot?.expiresAt === "number"
      ? new Date(bot.expiresAt).toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  // A 4xx from the sync route is a real answer ("wrong account", "no login"),
  // and its body carries the reason — worth surfacing verbatim rather than
  // flattening every failure to "something went wrong".
  const failure = sync.error
    ? ((sync.error as ApiError).body as { error?: string })?.error ??
      (sync.error as Error).message
    : sync.data && !sync.data.synced
      ? sync.data.error
      : null;
  const success = sync.data?.synced ? sync.data : null;

  return (
    <Card style={{ padding: Spacing.md, marginTop: Spacing.sm }}>
      {/* flexWrap and a shrinkable Label: this row is an uppercase, letter-spaced
          Label next to a Badge, and at 11px with letterSpacing 1.2 the label
          alone can exceed a phone's width. Without wrapping, the badge is
          pushed clean off the card. */}
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: Spacing.xs }}>
        <Label style={{ flexShrink: 1 }} numberOfLines={1}>Bot token</Label>
        <View style={{ flex: 1, minWidth: 0 }} />
        {synced ? (
          <Badge text="SYNCED" color={c.green} small />
        ) : bot?.expired ? (
          <Badge text="EXPIRED" color={c.amber} small />
        ) : null}
      </View>

      {synced ? (
        <Text style={{ color: c.green, fontSize: 12, marginTop: 6, fontWeight: "700" }}>
          ✓ Token synced{bot?.account ? ` for ${bot.account}` : ""}
          {until ? ` — valid until ${until}` : ""}
        </Text>
      ) : null}

      <Text style={{ color: c.dim, fontSize: 11, marginTop: 4, lineHeight: 16 }}>
        {synced
          ? "The executor has what it needs. Tokens lapse at 03:30 IST, so this is a once-a-morning job."
          : bot?.expired
            ? "The droplet's token has expired — sync a fresh one."
            : linked === false
              ? "Log in as the trading account first — the token it issues is what gets synced to the droplet."
              : "Pushes your order-capable token to the droplet so the executor can trade. Prices here use a separate read-only token and are unaffected."}
      </Text>

      {success ? (
        <Text style={{ color: c.green, fontSize: 11.5, marginTop: Spacing.sm }}>
          ✓ Synced for {success.account} — valid until 03:30 IST
        </Text>
      ) : failure ? (
        <Text style={{ color: c.red, fontSize: 11.5, marginTop: Spacing.sm, lineHeight: 16 }}>
          ✗ {failure}
        </Text>
      ) : null}

      {/* Nothing renders while the link state is unknown — briefly empty beats
          briefly wrong, since one button starts a browser round-trip and the
          other touches a live broker credential. */}
      {linked === false ? (
        <Button
          label={connecting ? "Opening Upstox…" : "Log in to trading account"}
          onPress={connect}
          loading={connecting}
          style={{ marginTop: Spacing.md }}
        />
      ) : linked === true ? (
        <Button
          label={sync.isPending ? "Syncing…" : synced ? "Re-sync" : "Sync token to droplet"}
          onPress={() => sync.mutate()}
          loading={sync.isPending}
          variant={synced ? "ghost" : undefined}
          style={{ marginTop: Spacing.md }}
        />
      ) : null}
    </Card>
  );
}

export default function FibBotScreen() {
  const c = useColors();
  const { data, isLoading, isRefetching, error, refetch } = useFibSignal();

  const contract = data?.contract ?? null;
  const signal = data?.signal ?? null;
  const tokenValid = data?.tokenValid === true;
  const state = stateOf(signal, tokenValid);
  const tone = stateTone(c, state);
  const bar = barLabel(signal?.asOf);
  const rr = signal?.rewardRiskRatio;

  const rrColor =
    rr == null ? c.text : rr >= 2 ? c.green : rr >= 1.5 ? c.amber : c.red;

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: Spacing.xxl }}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />
      }
    >
      {/* Upstox tokens lapse at 03:30 IST daily — the app's standard banner. */}
      <ConnectionBanner />

      <Label>Nifty futures · hourly · watch-only</Label>

      {isLoading ? (
        <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
          <SkeletonCard height={120} />
          <SkeletonStatRow count={3} />
          <SkeletonCard height={160} />
        </View>
      ) : error ? (
        // The route itself answers 200 even when it fails, so reaching here means
        // the network or the deployment is down — not a signal problem.
        <View style={{ marginTop: Spacing.md }}>
          <ErrorState message={(error as Error).message} onRetry={refetch} />
        </View>
      ) : (
        <>
          {/* What the bot on the droplet actually believes. Above the contract
              strip on purpose: "is it holding, is it paused, is it even up" is
              the question you open this screen with. */}
          <BotLiveState focus="hourly" />

          {/* ── Contract strip ─────────────────────────────────────────── */}
          <Card style={{ padding: Spacing.md, marginTop: Spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: "800", ...Type.numeric }}>
                {contract?.tradingSymbol ?? DASH}
              </Text>
              {/* The front month is still trading during the roll window, so an
                  unannounced contract change looks like a fault. This says the
                  switch was deliberate. */}
              {contract?.rolled ? <Badge text="ROLLED EARLY" color={c.purple} small /> : null}
            </View>
            <Text style={{ color: c.dim, fontSize: 10, marginTop: 2, ...Type.numeric }}>
              {contract?.instrumentKey ?? DASH}
            </Text>
            <View style={{ height: Spacing.sm }} />
            <KV k="Expiry" v={contract?.expiryDate ?? null} />
            <KV
              k="Days to expiry"
              v={contract ? (contract.daysToExpiry === 0 ? "expires today" : `${contract.daysToExpiry}d`) : null}
              color={contract && contract.daysToExpiry <= 3 ? c.amber : undefined}
            />
            <KV k="Lot size" v={contract ? String(contract.lotSize) : null} />
            {contract?.rollsInto ? <KV k="Rolls into" v={contract.rollsInto.tradingSymbol} /> : null}
          </Card>

          {/* ── Signal state (the hero) ────────────────────────────────── */}
          <Card
            tint={tone.tint}
            stripe={tone.tint}
            style={{ padding: Spacing.md, marginTop: Spacing.sm }}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: tone.tint, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 }}>
                  {tone.label}
                </Text>
                <Text style={{ color: c.dim, fontSize: 11, marginTop: 3, lineHeight: 15 }}>
                  {tone.note}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Label style={{ fontSize: 9 }}>As of</Label>
                <Text style={{ color: c.text, fontSize: 16, fontWeight: "800", ...Type.numeric }}>
                  {bar?.time ?? DASH}
                </Text>
                {bar ? (
                  <Text style={{ color: c.dim, fontSize: 9.5, ...Type.numeric }}>{bar.date} bar</Text>
                ) : null}
              </View>
            </View>

            {/* The engine's own words, verbatim — it already explains itself. */}
            {signal?.reason || data?.error ? (
              <Text style={{ color: c.soft, fontSize: 11.5, marginTop: Spacing.sm, lineHeight: 17 }}>
                {signal?.reason ?? data?.error}
              </Text>
            ) : null}
          </Card>

          {/* ── Entry, the number that matters most ────────────────────── */}
          <Card
            tint={state === "armed" ? c.accent : undefined}
            style={{ padding: Spacing.md, marginTop: Spacing.sm }}
          >
            <Label style={{ fontSize: 9.5 }}>Fib entry — limit buy</Label>
            <Text
              style={{
                color: state === "armed" ? c.accent : c.text,
                fontSize: 34,
                fontWeight: "800",
                letterSpacing: -1,
                marginTop: 4,
                ...Type.numeric,
              }}
            >
              {px(signal?.fibEntry)}
            </Text>
            <Text style={{ color: c.dim, fontSize: 10.5, marginTop: 2 }}>
              {state === "armed"
                ? "An order should be waiting here now"
                : "Where an order would wait once a setup appears"}
            </Text>
          </Card>

          {/* ── Stop / target / reward:risk ────────────────────────────── */}
          <View style={{ marginTop: Spacing.sm }}>
            <StatRow>
              <StatCard
                label="Stop"
                value={px(signal?.stopPrice)}
                sub={signal?.stopDistancePts != null ? `${px(signal.stopDistancePts)} pts risk` : undefined}
                color={c.red}
              />
              <StatCard
                label="Target"
                value={px(signal?.targetPrice)}
                sub={signal?.targetDistancePts != null ? `${px(signal.targetDistancePts)} pts reward` : undefined}
                color={c.green}
              />
              <StatCard
                label="R : R"
                value={rr != null ? `${num(rr, 2)}×` : DASH}
                sub="target ÷ risk"
                color={rrColor}
              />
            </StatRow>
          </View>

          {/* ── Supporting detail ──────────────────────────────────────── */}
          <Card style={{ padding: Spacing.md, marginTop: Spacing.sm }}>
            <Label>The swing behind it</Label>
            <View style={{ height: Spacing.xs }} />
            <KV k="Swing high (target)" v={px(signal?.swingHigh)} />
            <KV k="Swing low" v={px(signal?.swingLow)} />
            <KV k="Range" v={signal?.range != null ? `${px(signal.range)} pts` : null} />
            <KV k="Last close" v={px(signal?.lastClose)} />
            <KV k="ATR (14)" v={px(signal?.atr)} />
            {data?.config ? (
              <KV
                k="Rule"
                v={`${data.config.fibLevel} retrace · ${data.config.atrStopMult}× ATR stop · ${data.config.swingLookback}-bar swing`}
                mono={false}
              />
            ) : null}
          </Card>

          <BotTokenCard />

          {/* ── Footnotes ──────────────────────────────────────────────── */}
          <View
            style={{
              marginTop: Spacing.md,
              padding: Spacing.md,
              borderRadius: Radius.md,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.surface,
            }}
          >
            <Text style={{ color: c.dim, fontSize: 10.5, lineHeight: 16 }}>
              Levels come from the last closed hourly bar — the bar still forming is excluded, so
              nothing flickers mid-hour. Bars run 09:15, 10:15 … 15:15 IST, and the 15:15 bar is a
              15-minute stub closing with the session.
              {data?.barsUsed ? ` Computed from ${data.barsUsed} closed bars.` : ""}
            </Text>
            <Text style={{ color: c.dim, fontSize: 10.5, lineHeight: 16, marginTop: Spacing.sm }}>
              Watch-only. No orders are placed from this app.
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}
