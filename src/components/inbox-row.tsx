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

/**
 * Where a row's text begins: the dot gutter, the avatar, and the gaps around
 * them. The separator and the pinned Drafts row both line up against it, so it
 * is one expression rather than three that drift apart the first time the
 * avatar changes size.
 */
const TEXT_INSET = Spacing.two + 10 + Spacing.three + 40 + Spacing.three;

interface MarkReadResult {
  success: boolean;
  affected: number;
}

/**
 * One row of the inbox.
 *
 * Modelled on Apple Mail rather than Gmail, for a reason that is about data
 * rather than taste: Gmail's row is built around stars, labels and
 * swipe-to-archive, none of which this API can store. Mail's row expresses
 * exactly one piece of state — read or unread — which is exactly what saasmail
 * has. Borrowing the busier design would mean drawing affordances that cannot
 * be honoured.
 *
 * The unread dot is the only place violet appears in the list. That is what
 * makes it readable at a glance in a column of otherwise uniform rows.
 *
 * The same rule picks the swipe actions, and it bites harder here because a
 * row is a person or a group conversation, not a message. An action belongs
 * only if the API can express it at that granularity. Two can:
 *
 *  - Read. `POST /api/people/mark-read` and `POST /api/conversations/mark-read`
 *    each take aggregate ids and flip every unread message inside one. Offered
 *    only while the row has unread mail, because there is no aggregate
 *    mark-*unread* endpoint and the reverse therefore cannot be drawn.
 *  - Delete. `DELETE /api/people/{id}`, which is emphatically not "delete this
 *    conversation": it erases the person along with every message to and from
 *    them. So it is labelled and confirmed as that, and it is restricted to
 *    person rows (group conversations have no delete endpoint at all) and to
 *    admins (the route answers 403 to everyone else).
 *
 * Not used: `PATCH /api/emails/bulk`. It is registered after `PATCH
 * /api/emails/{id}`, so Hono matches "bulk" as an id and the bulk route is
 * unreachable — the server's own suite skips its tests saying exactly that.
 */
export function InboxRowItem({
  row,
  serverId,
  isAdmin,
  onLongPress,
}: {
  row: InboxRow;
  serverId: string;
  /** Whether this account may delete: `DELETE /api/people/{id}` is admin-only. */
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

  // Wider than the list that was just edited: marking an aggregate read also
  // flips `isRead` on every message inside the thread this row opens, and
  // deleting a person empties that thread entirely.
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
      // A person id and a conversation id come from different namespaces, so an
      // id on its own does not identify a row.
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

  /*
    A real UIKit menu on long-press, alongside the swipe.

    This matters because the swipe below is the one drawn control in the app.
    `.swipeActions` is a SwiftUI modifier that only applies to rows of a
    SwiftUI `List`, and this list is a `FlatList` — which it has to be, for
    `RefreshControl` and for the `Stack.SearchBar` integration. So the swipe
    panel is necessarily ours. The menu is not: `Link.Menu` renders a genuine
    `UIContextMenu`, with the system's blur, haptics, spring and accessibility.

    Both, rather than either, because they fail differently. The swipe is
    faster once you know it is there and is invisible until you try it; the
    menu is discoverable and names every action in words. Mail ships both for
    the same reason.
  */
  const content = (
    <Link href={`/thread/${row.id}?type=${row.type}`} asChild>
      <Link.Trigger>
      {/*
        Layout lives on the inner View, not on the Pressable's style function.
        `Link asChild` clones this Pressable to inject href and onPress, and a
        function style does not survive that reliably — the row silently fell
        back to the default column direction, stacking the avatar above the
        name. The Pressable keeps only the press feedback.

        Its background has to stay opaque whichever branch runs: it is what the
        swipe actions are revealed from behind.
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
            // The dot sits in this gutter, so an unread row is scannable from
            // the left edge without reading any text.
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
        {/*
          Read only, never unread: there is no aggregate mark-unread endpoint,
          so the reverse cannot be honoured at row granularity. `hidden` rather
          than omitted keeps the menu's shape stable between rows.
        */}
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

  // A row the API cannot act on carries no pan handler at all, rather than one
  // that opens onto nothing.
  if (!canMarkRead && !canDelete) return content;

  /*
    The action is revealed and then tapped; a full swipe does not fire it on
    release. Mail can afford that shortcut because its swipe moves one message
    into a Trash you can reopen. The equivalent slip here erases a
    correspondent's entire history, and saasmail has no undo anywhere.
  */
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
                The label takes the page background rather than white. The
                danger token inverts between themes — a deep red in light, a
                pale one in dark — so a fixed white label falls to roughly 2:1
                on the dark palette. The background inverts alongside it and
                stays legible against both.
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

/**
 * The way back to an unsent message.
 *
 * Pinned above the list rather than given a permanent home in the toolbar,
 * because it describes a temporary condition: a bar button spent on it would
 * sit there doing nothing most of the time. The count is passed in rather than
 * read here — drafts live in device storage (`lib/drafts.ts`) rather than
 * behind a query, so there is nothing to load and nothing to fail.
 */
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
            {/* Stands in for the unread gutter, so the avatar column and
                everything right of it lines up with the rows below. */}
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

      {/* Full width, unlike `RowSeparator`: this divides a pinned entry point
          from the list, not one row from the next. */}
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
 * The one control in this app that is drawn rather than borrowed.
 *
 * UIKit's swipe actions are `UIContextualAction` on a `UITableView`, which a
 * `FlatList` is not and cannot be made into, so there is no system control to
 * reach for here. Everything else — the compose button, the filter menu, the
 * discard sheet — stays native precisely so the exceptions stay countable.
 *
 * It sizes to its own content: `ReanimatedSwipeable` measures the panel to
 * decide where "open" is, so a hardcoded width would only be one that breaks
 * at the larger Dynamic Type sizes.
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
 * Rewrite every cached page of the inbox list, and hand back what was there.
 *
 * The list is keyed `[serverId, "people", "grouped", filter, search?]`, so one
 * prefix reaches all of them — the page on screen and the ones behind the
 * filter the user will switch back to. The filter is read out of its fixed
 * position rather than searched for, because a search for the word "unread"
 * would otherwise be indistinguishable from the unread filter and would start
 * dropping read rows out of its own results.
 *
 * It has to be read at all because a row that was just marked read no longer
 * belongs in a list titled Unread: leaving it there until the refetch lands
 * shows a read row under a filter promising the opposite.
 *
 * The return value is the rollback — hand it to `restoreLists`.
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
