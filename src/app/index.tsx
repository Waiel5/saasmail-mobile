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
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { DraftsRow, InboxRowItem, RowSeparator } from "@/components/inbox-row";
import { ServerSwitcherTitle } from "@/components/server-switcher";
import { Radius, Spacing, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, apiFetch } from "@/lib/api";
import { key } from "@/lib/query";
import type { GroupedResponse } from "@/lib/types";
import { useDrafts } from "@/lib/use-drafts";
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
          // `title` is set empty as well as supplying `headerTitle`: the
          // custom component replaces the title view, but the route name
          // ("index") still renders behind it otherwise.
          title: "",
          headerTitle: () => <ServerSwitcherTitle />,
          headerTransparent: true,
        }}
      />
      {/*
        Admin takes the navigation bar's leading slot rather than a place in
        the filter menu opposite it. That menu is a filter — its glyph fills to
        show filtering is on — and hanging a destination off it would make one
        control mean two things. It is absent rather than disabled for members:
        `/api/admin/*` answers 403 to them, so the button would be a door onto
        a wall. The record's `role` is advisory (the server enforces its own),
        which is exactly why this only decides what to draw.
      */}
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
        A named filter, not a nameless mode.

        Mail puts its filter bottom-left, but it earns that slot by expanding
        into a labelled "Filtered by / Unread" capsule when active. A
        UIBarButtonItem cannot do that — set `icon` and the title is dropped and
        kept only for VoiceOver — so an icon-only toggle down there means
        tapping it empties the list with nothing on screen saying why. The one
        thing a filter must never be is silently on.

        A menu names both states and marks the chosen one, and the filled glyph
        shows at a glance that filtering is active.
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
        The gesture root lives on this screen rather than in `_layout`, because
        this is the only screen with gestures. Nothing else belongs inside it:
        `react-native-screens` reaches a screen's content scroll view by walking
        `subviews[0]` downwards, and it is that view which is handed the
        content-inset adjustment and the scroll-edge effect — so a sibling added
        above the list here would quietly take both away from it. Dropping the
        wrapper is worse still: `GestureDetector` throws on mount in development
        without one.
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
          // Drafts are unsent mail with nowhere else to be listed, so they sit
          // above everything received. Absent rather than zeroed when there are
          // none: the row exists to say something is still waiting to go out.
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
        Two capsules with air between them, not one crowded bar.

        `separateBackground` on the search slot is not only cosmetic: it makes
        UIKit render the search as `integratedButton`, so it sits there as a
        magnifying glass and expands into the full field on tap. Stretched
        across the bar instead, the search field is the widest thing on screen
        and reads as the primary action — which it is not. Compose is.

        Both items are UIBarButtonItems. The previous version of this screen
        hand-rolled a circular Pressable with a box shadow, which is an Android
        FAB drawn in JavaScript: not the platform's control and not its shape.
        These inherit the system tint, the liquid-glass material, the press
        behaviour and the accessibility semantics for free.
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
