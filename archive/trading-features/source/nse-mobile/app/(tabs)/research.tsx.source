import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { StockSearch } from "@/components/StockSearch";
import { Card, Label, SectionHeader } from "@/components/ui";
import { Radius, Spacing, TAB_BAR_CLEARANCE, useColors } from "@/lib/theme";

// The web sidebar's Research group. Analysis is reached by searching a symbol
// (which pushes the same stock detail screen every list links to); the rest are
// pushed screens so each keeps its own scroll position and query state.
const LINKS: {
  href: string;
  title: string;
  desc: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}[] = [
  { href: "/research/protection", title: "Futures Protection", desc: "Recommended targets, purchased puts and expiry payoff plans", icon: "shield-checkmark-outline" },
  { href: "/research/gap-paper", title: "Gap Pullback · Paper", desc: "Five-stock research results, scanner status and hypothetical trades — no live orders", icon: "analytics-outline" },
  {
    href: "/research/screener",
    title: "Screener",
    desc: "Filter the universe by win rate, median return, sector and sample size",
    icon: "funnel-outline",
  },
  {
    href: "/research/sector-rotation",
    title: "Sector Rotation",
    desc: "Month-by-month strategy calendar, filtered for 10+ years of data",
    icon: "sync-outline",
  },
  {
    href: "/research/calendar",
    title: "Seasonal Calendar",
    desc: "Best and worst names across all twelve months at a glance",
    icon: "calendar-outline",
  },
  {
    href: "/research/backtest",
    title: "Backtest",
    desc: "Run the seasonal system over the snapshot and compare it to the benchmark",
    icon: "trending-up-outline",
  },
  {
    href: "/research/fib-bot",
    title: "Fib Bot",
    desc: "Live Fibonacci signal on Nifty futures — what the bot would do right now",
    icon: "hardware-chip-outline",
  },
  {
    href: "/research/fib-5m",
    title: "5-Min Fib",
    desc: "The same strategy on 5-minute bars — fills the idle time between hourly setups",
    icon: "timer-outline",
  },
  {
    href: "/research/crypto-fib",
    title: "Crypto Fib",
    desc: "The same swing-Fib strategy on Delta perpetuals — BTC and ETH, testnet",
    icon: "logo-bitcoin",
  },
];

export default function ResearchScreen() {
  const c = useColors();
  const router = useRouter();

  return (
    <SafeAreaView edges={["bottom"]} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: Spacing.md, paddingBottom: TAB_BAR_CLEARANCE }}
        keyboardShouldPersistTaps="handled"
      >
        <Label>Stock analysis</Label>
        <View style={{ height: Spacing.sm }} />
        <StockSearch onSelect={(symbol) => router.push(`/stock/${symbol}` as never)} />

        <SectionHeader title="Tools" icon="construct" />
        <View style={{ gap: Spacing.sm }}>
          {LINKS.map((l) => (
            <Pressable key={l.href} onPress={() => router.push(l.href as never)}>
              {({ pressed }) => (
                <Card style={{ padding: Spacing.md, opacity: pressed ? 0.7 : 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.md }}>
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: Radius.md,
                        backgroundColor: c.accentBg,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name={l.icon} size={18} color={c.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontSize: 14, fontWeight: "700" }}>{l.title}</Text>
                      <Text style={{ color: c.dim, fontSize: 11, marginTop: 3, lineHeight: 15 }}>
                        {l.desc}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={c.dim} />
                  </View>
                </Card>
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
