import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { useRef } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";

import { HAIRLINE, Radius, Spacing, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, apiFetch } from "@/lib/api";
import { formatCount, formatListTime } from "@/lib/format";
import { key } from "@/lib/query";
import {
  rowInitials,
  rowTitle,
  type GroupedResponse,
  type InboxRow,
} from "@/lib/types";

// Where a row's text begins. `RowSeparator` and `DraftsRow` align to it, so it
// has to track any change to the dot gutter or avatar size.
const TEXT_INSET = Spacing.two + 10 + Spacing.three + 40 + Spacing.three;

interface MarkReadResult {
  success: boolean;
  affected: number;
}

/**
 * One row of the inbox.
 *
 * `DELETE /api/people/{id}` is not "delete this conversation": it erases the
 * person and every message to and from them, and it 403s for non-admins. Group
 * conversations have no delete endpoint at all.
 * `PATCH /api/emails/bulk` is unreachable: it is registered after
 * `PATCH /api/emails/{id}`, so Hono matches "bulk" as an id.
 */
export function InboxRowItem({
  row,
  serverId,
  isAdmin,
  onLongPress,
}: {
  row: InboxRow;
  serverId: string;
  isAdmin?: boolean;
  onLongPress?: () => void;
}) {
  const c = useTheme();
  const queryClient = useQueryClient();
  const swipeable = useRef<SwipeableMethods>(null);

  const unread = row.unreadCount > 0;
  const title = rowTitle(row);

  const subtitle =
    row.type === "person"
      ? row.recipients.length > 1
        ? `${row.recipients.length} inboxes · ${row.totalCount} messages`
        : (row.recipients[0] ?? `${row.totalCount} messages`)
      : row.inbox;

  // Wider than the list that was just edited: both mutations also change the
  // thread this row opens.
  const settle = () => {
    queryClient.invalidateQueries({ queryKey: key(serverId) });
  };

  const announceFailure = async (heading: string, error: unknown) => {
    if (process.env.EXPO_OS === "ios") {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    Alert.alert(
      heading,
      error instanceof ApiError ? error.message : "Something went wrong.",
    );
  };

  const markRead = useMutation({
    mutationFn: () =>
      row.type === "person"
        ? apiFetch<MarkReadResult>(serverId, "/api/people/mark-read", {
            method: "POST",
            body: { personIds: [row.id] },
          })
        : apiFetch<MarkReadResult>(serverId, "/api/conversations/mark-read", {
            method: "POST",
            body: { conversationIds: [row.id] },
          }),
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: key(serverId, "people", "grouped"),
      });
      // Person ids and conversation ids are separate namespaces, so an id alone
      // does not identify a row.
      return patchLists(queryClient, serverId, (candidate) =>
        candidate.type === row.type && candidate.id === row.id
          ? { ...candidate, unreadCount: 0 }
          : candidate,
      );
    },
    onError: (error, _variables, before) => {
      if (before) restoreLists(queryClient, before);
      announceFailure("Could not mark as read", error);
    },
    onSettled: settle,
  });

  const deletePerson = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean }>(
        serverId,
        `/api/people/${encodeURIComponent(row.id)}`,
        { method: "DELETE" },
      ),
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: key(serverId, "people", "grouped"),
      });
      return patchLists(queryClient, serverId, (candidate) =>
        candidate.type === "person" && candidate.id === row.id
          ? null
          : candidate,
      );
    },
    onError: (error, _variables, before) => {
      if (before) restoreLists(queryClient, before);
      announceFailure("Could not delete", error);
    },
    onSettled: settle,
  });

  const onMarkRead = async () => {
    swipeable.current?.close();
    if (process.env.EXPO_OS === "ios") await Haptics.selectionAsync();
    markRead.mutate();
  };

  const onDelete = () => {
    swipeable.current?.close();
    Alert.alert(
      `Delete ${title}?`,
      "Every message to and from this address is erased from the server, along with its attachments, for everyone. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (process.env.EXPO_OS === "ios") {
              await Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Warning,
              );
            }
            deletePerson.mutate();
          },
        },
      ],
    );
  };

  const content = (
    <Link href={`/thread/${row.id}?type=${row.type}`} asChild>
      <Link.Trigger>
      {/*
        Layout stays on the inner View. `Link asChild` clones this Pressable to
        inject href and onPress, and a function style does not survive that
        reliably: the row falls back to column direction. Keep the background
        opaque in both branches, the swipe actions reveal from behind it.
      */}
      <Pressable
        onLongPress={onLongPress}
        style={({ pressed }) => ({
          backgroundColor: pressed ? c.backgroundSelected : c.background,
        })}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: Spacing.three,
            paddingVertical: Spacing.three,
            paddingRight: Spacing.four,
            paddingLeft: Spacing.two,
          }}
        >
          <View style={{ width: 10, alignItems: "center" }}>
            {unread ? (
              <View
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: Radius.full,
                  backgroundColor: c.unread,
                }}
              />
            ) : null}
          </View>

          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: Radius.full,
              backgroundColor: c.backgroundSubtle,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                ...Type.subhead,
                fontWeight: "600",
                color: c.textSecondary,
              }}
            >
              {rowInitials(row)}
            </Text>
          </View>

          <View style={{ flex: 1, gap: 2 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "baseline",
                gap: Spacing.two,
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  ...Type.body,
                  flex: 1,
                  fontWeight: unread ? "600" : "400",
                  color: c.text,
                }}
              >
                {title}
              </Text>
              <Text
                style={{
                  ...Type.caption,
                  color: c.textTertiary,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatListTime(row.lastEmailAt)}
              </Text>
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: Spacing.two,
              }}
            >
              <Text
                numberOfLines={1}
                style={{ ...Type.footnote, flex: 1, color: c.textSecondary }}
              >
                {subtitle}
              </Text>

              {row.hasAttachment ? (
                <Image
                  source="sf:paperclip"
                  tintColor={c.textTertiary}
                  style={{ width: 13, height: 13 }}
                />
              ) : null}

              {unread ? (
                <View
                  style={{
                    minWidth: 20,
                    paddingHorizontal: Spacing.one + 1,
                    paddingVertical: 1,
                    borderRadius: Radius.full,
                    backgroundColor: c.unread,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      ...Type.caption,
                      fontWeight: "600",
                      color: "#FFFFFF",
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatCount(row.unreadCount)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
      </Link.Trigger>
      <Link.Menu>
        {/* Read only, never unread: there is no aggregate mark-unread endpoint. */}
        <Link.MenuAction
          icon="envelope.open"
          hidden={!unread}
          onPress={onMarkRead}
        >
          Mark as Read
        </Link.MenuAction>
        {isAdmin && row.type === "person" ? (
          <Link.MenuAction icon="trash" destructive onPress={onDelete}>
            Delete
          </Link.MenuAction>
        ) : null}
      </Link.Menu>
    </Link>
  );

  const canMarkRead = unread;
  const canDelete = !!isAdmin && row.type === "person";

  if (!canMarkRead && !canDelete) return content;

  // Actions are revealed then tapped, never fired by a full swipe: the right
  // one erases a correspondent's entire history and there is no undo anywhere.
  return (
    <ReanimatedSwipeable
      ref={swipeable}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={
        canMarkRead
          ? () => (
              <SwipeAction
                label="Read"
                icon="sf:envelope.open"
                background={c.primary}
                foreground={c.onPrimary}
                onPress={onMarkRead}
              />
            )
          : undefined
      }
      renderRightActions={
        canDelete
          ? () => (
              /*
                Foreground is the page background, not white: the danger token
                inverts between themes, so a fixed white label drops to about
                2:1 on the dark palette.
              */
              <SwipeAction
                label="Delete"
                icon="sf:trash"
                background={c.danger}
                foreground={c.background}
                onPress={onDelete}
              />
            )
          : undefined
      }
    >
      {content}
    </ReanimatedSwipeable>
  );
}

/** Pinned link to unsent drafts, which live in device storage (`lib/drafts.ts`). */
export function DraftsRow({ count }: { count: number }) {
  const c = useTheme();
  return (
    <View>
      <Link href="/drafts" asChild>
        <Pressable
          style={({ pressed }) => ({
            backgroundColor: pressed ? c.backgroundSelected : c.background,
          })}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: Spacing.three,
              paddingVertical: Spacing.three,
              paddingRight: Spacing.four,
              paddingLeft: Spacing.two,
            }}
          >
            {/* Stands in for the unread dot gutter so this row aligns with the list. */}
            <View style={{ width: 10 }} />

            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: Radius.full,
                backgroundColor: c.backgroundSubtle,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Image
                source="sf:square.and.pencil"
                tintColor={c.textSecondary}
                style={{ width: 18, height: 18 }}
              />
            </View>

            <Text style={{ ...Type.body, flex: 1, color: c.text }}>Drafts</Text>
            <Text
              style={{
                ...Type.body,
                color: c.textTertiary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatCount(count)}
            </Text>
            <Image
              source="sf:chevron.right"
              tintColor={c.textTertiary}
              style={{ width: 11, height: 11 }}
            />
          </View>
        </Pressable>
      </Link>

      {/* Full width, unlike `RowSeparator`: this divides the pinned row from the list. */}
      <View style={{ height: HAIRLINE, backgroundColor: c.border }} />
    </View>
  );
}

/** Inset separator, aligned to the text rather than the screen edge. */
export function RowSeparator() {
  const c = useTheme();
  return (
    <View
      style={{
        height: HAIRLINE,
        backgroundColor: c.border,
        marginLeft: TEXT_INSET,
      }}
    />
  );
}

/**
 * Sized by its own content: `ReanimatedSwipeable` measures the panel to decide
 * where "open" is, so a hardcoded width breaks at large Dynamic Type sizes.
 */
function SwipeAction({
  label,
  icon,
  background,
  foreground,
  onPress,
}: {
  label: string;
  icon: string;
  background: string;
  foreground: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        justifyContent: "center",
        alignItems: "center",
        gap: Spacing.half,
        paddingHorizontal: Spacing.five,
        backgroundColor: background,
      }}
    >
      <Image
        source={icon}
        tintColor={foreground}
        style={{ width: 22, height: 22 }}
      />
      <Text style={{ ...Type.caption, fontWeight: "600", color: foreground }}>
        {label}
      </Text>
    </Pressable>
  );
}

type CachedList = [QueryKey, GroupedResponse | undefined];

/**
 * Rewrite every cached page of the inbox list; returns the rollback for
 * `restoreLists`.
 *
 * The list is keyed `[serverId, "people", "grouped", filter, search?]`. The
 * filter is read from its fixed slot rather than searched for: a search whose
 * text is "unread" would otherwise look like the unread filter and start
 * dropping read rows out of its own results.
 */
function patchLists(
  queryClient: QueryClient,
  serverId: string,
  edit: (row: InboxRow) => InboxRow | null,
): CachedList[] {
  const before = queryClient.getQueriesData<GroupedResponse>({
    queryKey: key(serverId, "people", "grouped"),
  });

  for (const [queryKey, page] of before) {
    if (!page) continue;
    const unreadOnly = queryKey[3] === "unread";
    const data = page.data.flatMap((row) => {
      const next = edit(row);
      if (!next) return [];
      if (unreadOnly && next.unreadCount === 0) return [];
      return [next];
    });
    queryClient.setQueryData<GroupedResponse>(queryKey, {
      ...page,
      data,
      total: page.total - (page.data.length - data.length),
    });
  }

  return before;
}

function restoreLists(queryClient: QueryClient, before: CachedList[]): void {
  for (const [queryKey, page] of before) {
    queryClient.setQueryData<GroupedResponse>(queryKey, page);
  }
}
