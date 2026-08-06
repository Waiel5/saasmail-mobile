import { QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { useColorScheme } from "react-native";

import { Colors } from "@/constants/theme";
import { queryClient } from "@/lib/query";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // `preventAutoHideAsync` above holds the splash until something hides it.
  // Without this the app sits on the splash for ever.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {
      // Already hidden, or the module is unavailable — not worth surfacing.
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack
          screenOptions={{
            headerTransparent: true,
            headerShadowVisible: false,
            headerLargeTitleShadowVisible: false,
            headerLargeStyle: { backgroundColor: "transparent" },
            headerBackButtonDisplayMode: "minimal",
          }}
        >
          {/* title '' or the route name renders on first run, before the inbox
              screen mounts its own headerTitle. */}
          <Stack.Screen
            name="index"
            options={{ headerLargeTitle: false, title: '' }}
          />
          <Stack.Screen name="settings" options={{ title: "Settings" }} />
          <Stack.Screen
            name="drafts"
            options={{
              title: "Drafts",
              // Opaque, unlike the rest of the app: this screen is a SwiftUI
              // `List` in a host view, so there is no React Native scroll view
              // for `contentInsetAdjustmentBehavior` to attach to.
              headerTransparent: false,
            }}
          />
          <Stack.Screen
            name="add-server"
            options={{
              presentation: "formSheet",
              sheetGrabberVisible: true,
              sheetAllowedDetents: [0.6, 1.0],
              title: "Add a server",
              // Opaque, not the default translucent: the lime button on the
              // screen behind bleeds through as a smudge under the body copy.
              contentStyle: {
                backgroundColor:
                  colorScheme === "dark"
                    ? Colors.dark.background
                    : Colors.light.background,
              },
            }}
          />
          <Stack.Screen
            name="compose"
            options={{
              // `presentation` must be declared here on the layout's screen;
              // set from inside the route it is read after the push.
              presentation: 'modal',
              // Transparent would put the From row behind the title with no
              // scroll available to reveal it.
              headerTransparent: false,
              contentStyle: {
                backgroundColor:
                  colorScheme === 'dark'
                    ? Colors.dark.background
                    : Colors.light.background,
              },
            }}
          />
          <Stack.Screen
            name="thread/[personId]"
            options={{ headerLargeTitle: false }}
          />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
