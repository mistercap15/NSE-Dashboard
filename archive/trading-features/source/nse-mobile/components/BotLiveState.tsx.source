import React from "react";
import { Text, View } from "react-native";
import { Badge, Card, KV, Label } from "@/components/ui";
import { useBotStatus } from "@/lib/queries";
import { num } from "@/lib/format";
import { Spacing, useColors } from "@/lib/theme";

// ─────────────────────────────────────────────────────────────────────────────
// What a bot on the droplet actually believes — one card, shared by all three
// bot screens.
//
// WHY IT IS SHARED. Every bot screen wants the same five facts (is the service
// up, is it paused or halted, is it holding, what did it freeze as its stop and
// target, and — for the two Nifty bots — who owns the contract). Three copies
// would drift, and the copy that drifted would be the one you were reading on
// the day it mattered.
//
// WHAT IT SAYS THAT A SIGNAL CANNOT. A signal says what the STRATEGY thinks.
// This says what the BOT thinks. On 7 Sep 2026 those disagreed: the signals
// were entirely normal while the hourly bot had adopted the 5-min bot's
// position and both were bracketing the same 65 lots. Hence the red banner
// when two bots on one contract both report a position — the single condition
// that must never be true.
//
// It always badges its source. When the droplet is unreachable it says so
// rather than silently showing nothing, because "no alarm" and "cannot see"
// look identical otherwise and only one of them is safe.
//
// LAYOUT: everything here has to survive a narrow phone. Header rows wrap, and
// values go through KV, which flexes rather than running off the card.
// ─────────────────────────────────────────────────────────────────────────────

const px = (n: number | null | undefined) => num(n, 2);

/** The two that share one Nifty contract, and therefore one another's fate. */
const NIFTY = ["hourly", "fivemin"] as const;
const NAMES: Record<string, string> = {
  hourly: "Hourly bot",
  fivemin: "5-min bot",
  crypto: "Crypto bot",
};

export function BotLiveState({ focus }: { focus: "hourly" | "fivemin" | "crypto" }) {
  const c = useColors();
  const status = useBotStatus();

  const live = status.data?.reachable === true;
  const bots = live ? status.data?.bots ?? null : null;
  const me = bots?.[focus] ?? null;
  const claim = live ? status.data?.claim ?? null : null;

  const sharesContract = (NIFTY as readonly string[]).includes(focus);
  const otherKey = focus === "hourly" ? "fivemin" : "hourly";
  const other = sharesContract ? bots?.[otherKey] ?? null : null;
  const bothHolding = Boolean(me?.holding && other?.holding);

  /** One phrase for a bot's condition, most alarming first. */
  const line = (b: typeof me) => {
    if (!b) return null;
    if (b.service !== "active") return `SERVICE ${b.service.toUpperCase()}`;
    if (b.halted) return "HALTED — places nothing";
    if (b.enabled === false) return "PAUSED — no new trades";
    if (b.holding) return "Holding a position";
    if (b.armed) return "Order armed";
    if (b.stale) return "State stale — may be down";
    return "Flat";
  };

  const tone = (b: typeof me) =>
    !b ? c.dim
      : b.service !== "active" || b.stale ? c.red
        : b.halted || b.enabled === false ? c.amber
          : b.holding ? c.accent
            : c.soft;

  return (
    <>
      {bothHolding ? (
        <Card tint={c.red} stripe={c.red} style={{ padding: Spacing.md, marginTop: Spacing.sm }}>
          <Text style={{ color: c.red, fontSize: 13, fontWeight: "800" }}>
            ⚠ BOTH BOTS REPORT A POSITION
          </Text>
          <Text style={{ color: c.soft, fontSize: 11.5, marginTop: 4, lineHeight: 17 }}>
            Only one may ever hold this contract — Upstox nets positions, so two trades become one
            number with two brackets on it. Check the account and send /halt to both bots.
          </Text>
        </Card>
      ) : null}

      <Card style={{ padding: Spacing.md, marginTop: Spacing.sm }}>
        {/* flexWrap, not space-between: an uppercase letter-spaced label plus a
            badge is wider than a narrow phone, and without wrapping the badge
            is pushed off the card entirely. */}
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: Spacing.xs }}>
          <Label style={{ flexShrink: 1 }}>The bot itself</Label>
          <View style={{ flex: 1, minWidth: 0 }} />
          <Badge text={live ? "LIVE" : "OFFLINE"} color={live ? c.green : c.amber} small />
        </View>

        <View style={{ height: Spacing.xs }} />

        <KV k={NAMES[focus]} v={line(me) ?? "—"} color={tone(me)} />
        {me?.holding ? (
          <>
            <KV k="Entry" v={px(me.entryPrice)} />
            <KV k="Its stop" v={px(me.stop)} color={c.red} />
            <KV k="Its target" v={px(me.target)} color={c.green} />
            {me.barsHeld != null ? <KV k="Bars held" v={String(me.barsHeld)} /> : null}
          </>
        ) : null}

        {sharesContract ? (
          <>
            <KV k={NAMES[otherKey]} v={line(other) ?? "—"} color={tone(other)} />
            <KV
              k="Contract claim"
              v={
                claim
                  ? `${claim.owner === "5m" ? "5-min bot" : "hourly bot"} · ${
                      claim.holding ? "filled" : "order out"
                    }`
                  : live ? "nobody" : null
              }
            />
          </>
        ) : null}

        {me?.stale ? (
          <Text style={{ color: c.amber, fontSize: 10, marginTop: Spacing.sm, lineHeight: 15 }}>
            Its state file has not been written for {Math.round(me.stateAgeSeconds ?? 0)}s during a
            session — it may be down or faulting.
          </Text>
        ) : null}

        {me && !me.stale && me.idle ? (
          <Text style={{ color: c.dim, fontSize: 10, marginTop: Spacing.sm, lineHeight: 15 }}>
            Market closed — it idles without polling, so its state file is deliberately not being
            written.
          </Text>
        ) : null}

        {!live ? (
          <Text style={{ color: c.dim, fontSize: 10, marginTop: Spacing.sm, lineHeight: 15 }}>
            {status.data?.error ??
              "Could not reach the droplet, so this is what the bots last said — not what they are doing now."}
          </Text>
        ) : null}
      </Card>
    </>
  );
}
