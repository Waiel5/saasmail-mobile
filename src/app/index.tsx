import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { DraftsRow, InboxRowItem, RowSeparator } from "@/components/inbox-row";
import { ServerSwitcherTitle } from "@/components/server-switcher";
import { Radius, Spacing, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, apiFetch } from "@/lib/api";
import { key } from "@/lib/query";
import type { GroupedResponse, Me } from "@/lib/types";
import { useDrafts } from "@/lib/use-drafts";
import { upsertServer } from "@/lib/servers";
import { useActiveServer } from "@/lib/use-servers";

export default function InboxScreen() {
  const c = useTheme();
  const router = useRouter();
  const server = useActiveServer();
  const drafts = useDrafts(server?.id);
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

  // `server.role` is a snapshot taken when the server was added, so it goes
  // stale on promotion or demotion. Re-read it and write it back below.
  const me = useQuery({
    queryKey: key(server?.id ?? "none", "me"),
    enabled: !!server,
    queryFn: () => apiFetch<Me>(server!.id, "/api/user/me"),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!server || !me.data) return;
    const role = me.data.role ?? undefined;
    if (role === server.role) return;
    upsertServer({ ...server, role });
  }, [me.data, server]);

  if (!server) return <FirstRun />;

  const rows = query.data?.data ?? [];

  const setFilter = async (next: boolean) => {
    if (process.env.EXPO_OS === "ios") await Haptics.selectionAsync();
    setUnreadOnly(next);
  };

  return (
    <>
      <Stack.Screen
        options={{
          // Empty `title` as well as `headerTitle`: without it the route name
          // ("index") still renders behind the custom component.
          title: "",
          headerTitle: () => <ServerSwitcherTitle />,
          headerTransparent: true,
        }}
      />
      {/* Advisory only: `/api/admin/*` re-checks the role server-side. */}
      {server.role === "admin" ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            icon="lock.shield"
            accessibilityLabel="Server admin"
            onPress={() => router.push("/admin")}
          />
        </Stack.Toolbar>
      ) : null}

      {/*
        A menu rather than a toggle button: setting `icon` on a bar button
        drops its title (VoiceOver only), so a plain toggle would empty the
        list with nothing on screen naming the filter.
      */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu
          accessibilityLabel="Filter messages"
          icon={
            unreadOnly
              ? "line.3.horizontal.decrease.circle.fill"
              : "line.3.horizontal.decrease.circle"
          }
        >
          <Stack.Toolbar.MenuAction
            isOn={!unreadOnly}
            onPress={() => setFilter(false)}
          >
            All
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            isOn={unreadOnly}
            onPress={() => setFilter(true)}
          >
            Unread
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <Stack.SearchBar
        placeholder="Search people and addresses"
        onChangeText={(e) => setSearch(e.nativeEvent.text)}
      />

      {/*
        Keep the list the only child: `react-native-screens` finds the content
        scroll view by walking `subviews[0]`, so a sibling above it here steals
        the content-inset adjustment and scroll-edge effect. The wrapper itself
        is required — `GestureDetector` throws on mount in dev without one.
      */}
      <GestureHandlerRootView style={{ flex: 1 }}>
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
          ListHeaderComponent={
            drafts.length > 0 ? <DraftsRow count={drafts.length} /> : null
          }
          renderItem={({ item }) => (
            <InboxRowItem
              row={item}
              serverId={server.id}
              isAdmin={server.role === "admin"}
            />
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
      </GestureHandlerRootView>

      {/*
        `separateBackground` is not cosmetic on the search slot: it makes UIKit
        render the search as `integratedButton`, a glyph that expands into the
        field on tap instead of stretching across the whole bar.
      */}
      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.SearchBarSlot separateBackground />
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button
          icon="square.and.pencil"
          accessibilityLabel="New message"
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

  // Branch on `error` first, not on `ApiError`: anything the query throws is a
  // broken server, and falling through renders "No messages yet" with no retry.
  if (error) {
    icon = "sf:exclamationmark.triangle";
    action = { label: "Try again", onPress: onRetry };
    if (!(error instanceof ApiError)) {
      message = "Something went wrong loading your mail.";
    } else if (error.kind === "passkey-required") {
      // No retry action: neither a refetch nor a fresh token can clear this.
      action = null;
      message =
        "This account needs a passkey before the app can read mail. Open your server in a browser, register one, then pull to refresh.";
    } else if (error.kind === "insufficient-scope") {
      action = null;
      message =
        "This app was not granted permission to read mail on this server. Sign out and connect it again.";
    } else if (error.kind === "network") {
      icon = "sf:wifi.slash";
      message = "Cannot reach your server. Check your connection.";
    } else {
      message = error.message;
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

// Not a redirect into the add-server sheet: presented over an empty stack it
// has nothing behind it and reads as a blank screen.
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
