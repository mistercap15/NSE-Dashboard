import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { onSessionExpired } from "@/lib/client";
import { loadSession, peekSession } from "@/lib/session";
import { useColors, useIsDark } from "@/lib/theme";
import { LoginScreen } from "@/components/LoginScreen";

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 clears the session and shows the PIN gate; a 429 is a deliberate
      // lockout. Retrying either is noise.
      retry: (count, error) => {
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 429) return false;
        return count < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Root gate. Everything past this point assumes a valid session token, so the
// PIN screen renders in place of the navigator rather than as a route — there is
// no authenticated screen to briefly flash before a redirect.
// ─────────────────────────────────────────────────────────────────────────────
function Gate() {
  const colors = useColors();
  const isDark = useIsDark();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    loadSession().then((token) => {
      setAuthed(Boolean(token));
      setReady(true);
      SplashScreen.hideAsync().catch(() => {});
    });
  }, []);

  // The client clears the stored token on any 401 (i.e. past 03:30 IST) and
  // notifies here, which drops straight back to the PIN screen.
  useEffect(() => onSessionExpired(() => setAuthed(false)), []);

  const handleAuthed = useCallback(() => {
    setAuthed(Boolean(peekSession()));
  }, []);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      {authed ? (
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.accent,
            headerTitleStyle: { fontWeight: "800", fontSize: 17, color: colors.text },
            contentStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
            headerBackButtonDisplayMode: "minimal",
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* OAuth hand-back; renders headerless and replaces itself with Home. */}
          <Stack.Screen name="upstox/connected" options={{ headerShown: false }} />
          <Stack.Screen name="stock/[symbol]" options={{ title: "Stock" }} />
          <Stack.Screen name="research/protection-tracked" options={{ title: "Tracked Stocks" }} />
            <Stack.Screen name="research/protection-detail" options={{ title: "Position Protection" }} />
            <Stack.Screen name="research/protection" options={{ title: "Futures Protection" }} />
          <Stack.Screen name="research/gap-paper" options={{ title: "Gap Pullback · Paper" }} />
          <Stack.Screen name="research/gap-paper-history" options={{ title: "Historical pilot" }} />
          <Stack.Screen name="research/screener" options={{ title: "Screener" }} />
          <Stack.Screen name="research/sector-rotation" options={{ title: "Sector Rotation" }} />
          <Stack.Screen name="research/calendar" options={{ title: "Calendar" }} />
          <Stack.Screen name="research/backtest" options={{ title: "Backtest" }} />
          <Stack.Screen name="research/fib-bot" options={{ title: "Fib Bot" }} />
          <Stack.Screen name="research/fib-5m" options={{ title: "5-Min Fib" }} />
          <Stack.Screen name="research/crypto-fib" options={{ title: "Crypto Fib" }} />
        </Stack>
      ) : (
        <LoginScreen onAuthenticated={handleAuthed} />
      )}
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <Gate />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
