import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { HAIRLINE, Radius, Spacing, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { formatCount, formatListTime } from "@/lib/format";
import { rowInitials, rowTitle, type InboxRow } from "@/lib/types";

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
 */
export function InboxRowItem({
  row,
  serverId,
  onLongPress,
}: {
  row: InboxRow;
  serverId: string;
  onLongPress?: () => void;
}) {
  const c = useTheme();
  const unread = row.unreadCount > 0;
  const title = rowTitle(row);

  const subtitle =
    row.type === "person"
      ? row.recipients.length > 1
        ? `${row.recipients.length} inboxes · ${row.totalCount} messages`
        : (row.recipients[0] ?? `${row.totalCount} messages`)
      : row.inbox;

  return (
    <Link href={`/thread/${row.id}?type=${row.type}`} asChild>
      {/*
        Layout lives on the inner View, not on the Pressable's style function.
        `Link asChild` clones this Pressable to inject href and onPress, and a
        function style does not survive that reliably — the row silently fell
        back to the default column direction, stacking the avatar above the
        name. The Pressable keeps only the press feedback.
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
    </Link>
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
        marginLeft: Spacing.two + 10 + Spacing.three + 40 + Spacing.three,
      }}
    />
  );
}
