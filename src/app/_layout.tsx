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

  // `preventAutoHideAsync` above holds the splash until we say so, and nothing
  // else will: without this the app sits on the splash for ever. The server
  // list is read synchronously from local storage, so there is nothing to wait
  // for beyond the first render.
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
          <Stack.Screen name="index" options={{ headerLargeTitle: false }} />
          <Stack.Screen name="settings" options={{ title: "Settings" }} />
          <Stack.Screen
            name="add-server"
            options={{
              // A sheet rather than a full screen: adding a server is a side
              // errand, and the sheet keeps whatever the user was doing behind
              // it — which matters once they already have accounts and are
              // adding another.
              presentation: "formSheet",
              sheetGrabberVisible: true,
              sheetAllowedDetents: [0.6, 1.0],
              title: "Add a server",
              // Opaque, not the default translucent. The screen underneath has
              // a bright lime button, and a translucent sheet let it bleed
              // through as a coloured smudge behind the body text. Liquid glass
              // flatters a photo or a list; it does not flatter a saturated
              // accent sitting directly behind paragraph copy.
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
              // A full modal rather than a form sheet. A sheet is right for a
              // short errand like adding a server; writing a message is the
              // longest-lived thing anyone does in this app, and a sheet spends
              // the top of the screen showing what is behind it at exactly the
              // moment the keyboard is taking the bottom half.
              //
              // `presentation` has to be declared here, on the layout's screen
              // — set from inside the route it is read too late to change how
              // the screen was pushed.
              presentation: 'modal',
              // Overrides the transparent header the rest of the app uses.
              // Transparent is right for a scrolling list, where content
              // sliding under a blur is the effect; here it put the From row
              // directly beneath the title, hidden behind it, with no scroll
              // available to reveal it — the first field of the form was
              // simply invisible.
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
