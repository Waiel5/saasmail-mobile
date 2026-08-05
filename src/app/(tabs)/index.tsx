import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";

import { InboxRowItem, RowSeparator } from "@/components/inbox-row";
import { ServerSwitcherTitle } from "@/components/server-switcher";
import { Radius, Spacing, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, apiFetch } from "@/lib/api";
import { key } from "@/lib/query";
import type { GroupedResponse } from "@/lib/types";
import { useActiveServer } from "@/lib/use-servers";

export default function InboxScreen() {
  const c = useTheme();
  const router = useRouter();
  const server = useActiveServer();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");

  const trimmed = search.trim();
  const query = useQuery({
    queryKey: key(
      server?.id ?? "none",
      "people",
      "grouped",
      unreadOnly ? "unread" : "all",
      trimmed || undefined,
    ),
    enabled: !!server,
    queryFn: () =>
      apiFetch<GroupedResponse>(
        server!.id,
        `/api/people/grouped?limit=50${unreadOnly ? "&unread=1" : ""}` +
          (trimmed ? `&q=${encodeURIComponent(trimmed)}` : ""),
      ),
  });

  if (!server) return <FirstRun />;

  const rows = query.data?.data ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => <ServerSwitcherTitle />,
          headerTransparent: true,
        }}
      />
      <Stack.SearchBar
        placeholder="Search people and addresses"
        onChangeText={(e) => setSearch(e.nativeEvent.text)}
      />

      <FlatList
        data={rows}
        keyExtractor={(row) => `${row.type}:${row.id}`}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        ItemSeparatorComponent={RowSeparator}
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => query.refetch()}
          />
        }
        renderItem={({ item }) => (
          <InboxRowItem row={item} serverId={server.id} />
        )}
        ListEmptyComponent={
          query.isLoading ? (
            <View style={{ paddingTop: Spacing.seven, alignItems: "center" }}>
              <ActivityIndicator />
            </View>
          ) : (
            <EmptyState
              error={query.error}
              unreadOnly={unreadOnly}
              searchTerm={trimmed}
              onRetry={() => query.refetch()}
            />
          )
        }
      />

      {/*
        The real bottom toolbar, not a drawn one. This is the layout Mail uses:
        filter on the left, the search field in the middle, compose on the
        right with its own background so it reads as the primary action.

        The previous version of this screen hand-rolled a circular button with
        a box shadow — an Android FAB drawn in JavaScript, which is neither the
        platform's control nor the platform's shape. This is a UIBarButtonItem:
        it inherits the system tint, the liquid-glass material, the press
        behaviour and the accessibility semantics for free.
      */}
      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.Button
          icon="line.3.horizontal.decrease"
          selected={unreadOnly}
          onPress={async () => {
            if (process.env.EXPO_OS === "ios") await Haptics.selectionAsync();
            setUnreadOnly((v) => !v);
          }}
        />
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.SearchBarSlot />
        <Stack.Toolbar.Button
          icon="square.and.pencil"
          separateBackground
          onPress={async () => {
            if (process.env.EXPO_OS === "ios") {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            router.push("/compose");
          }}
        />
      </Stack.Toolbar>
    </>
  );
}

/**
 * Every way this list can be empty, said differently.
 *
 * They are genuinely different situations, and collapsing them into "no
 * messages" sends people looking for a problem in the wrong place — most
 * sharply for an account that is refused rather than quiet.
 */
function EmptyState({
  error,
  unreadOnly,
  searchTerm,
  onRetry,
}: {
  error: unknown;
  unreadOnly: boolean;
  searchTerm: string;
  onRetry: () => void;
}) {
  const c = useTheme();

  let icon = "sf:tray";
  let message =
    "No messages yet. When someone emails one of your inboxes, they appear here.";
  let action: { label: string; onPress: () => void } | null = null;

  if (error instanceof ApiError) {
    icon = "sf:exclamationmark.triangle";
    if (error.kind === "passkey-required") {
      // Retrying cannot fix this and neither can a fresh token, so this offers
      // the actual remedy rather than a button that does nothing.
      message =
        "This account needs a passkey before the app can read mail. Open your server in a browser, register one, then pull to refresh.";
    } else if (error.kind === "insufficient-scope") {
      message =
        "This app was not granted permission to read mail on this server. Sign out and connect it again.";
    } else if (error.kind === "network") {
      icon = "sf:wifi.slash";
      message = "Cannot reach your server. Check your connection.";
      action = { label: "Try again", onPress: onRetry };
    } else {
      message = error.message;
      action = { label: "Try again", onPress: onRetry };
    }
  } else if (searchTerm) {
    icon = "sf:magnifyingglass";
    message = `Nobody matches “${searchTerm}”.`;
  } else if (unreadOnly) {
    icon = "sf:checkmark.circle";
    message = "Nothing unread. You are all caught up.";
  }

  return (
    <View
      style={{
        paddingTop: Spacing.seven,
        paddingHorizontal: Spacing.six,
        gap: Spacing.three,
        alignItems: "center",
      }}
    >
      <Image
        source={icon}
        tintColor={c.textTertiary}
        style={{ width: 34, height: 34 }}
      />
      <Text
        selectable
        style={{ ...Type.callout, color: c.textSecondary, textAlign: "center" }}
      >
        {message}
      </Text>
      {action ? (
        <Pressable
          onPress={action.onPress}
          style={{
            paddingHorizontal: Spacing.five,
            paddingVertical: Spacing.two,
            borderRadius: Radius.full,
            backgroundColor: c.backgroundSubtle,
          }}
        >
          <Text style={{ ...Type.subhead, fontWeight: "600", color: c.text }}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * What a brand-new install sees.
 *
 * Deliberately not a redirect into the add-server sheet: a sheet presented over
 * an empty stack has nothing behind it and reads as a blank screen. This
 * explains *why* an address is needed — self-hosting is the part a newcomer
 * will not assume.
 */
function FirstRun() {
  const c = useTheme();
  const router = useRouter();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: Spacing.four,
        paddingHorizontal: Spacing.six,
      }}
    >
      <Image
        source="sf:tray.and.arrow.down"
        tintColor={c.primary}
        style={{ width: 52, height: 52 }}
      />
      <Text style={{ ...Type.title, color: c.text, textAlign: "center" }}>
        Connect your mail
      </Text>
      <Text
        style={{ ...Type.callout, color: c.textSecondary, textAlign: "center" }}
      >
        saasmail runs on your own Cloudflare account, so there is no account to
        sign up for. Point the app at your deployment and sign in there.
      </Text>
      <Pressable
        onPress={() => router.push("/add-server")}
        style={({ pressed }) => ({
          paddingHorizontal: Spacing.six,
          paddingVertical: Spacing.three,
          borderRadius: Radius.full,
          backgroundColor: c.primary,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ ...Type.headline, color: c.onPrimary }}>
          Add a server
        </Text>
      </Pressable>
    </View>
  );
}
