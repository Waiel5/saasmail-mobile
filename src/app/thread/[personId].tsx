import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { AttachmentRow } from '@/components/attachment-row';
import { DeliveryBadge, deliveryState, deliveryTint } from '@/components/delivery-badge';
import { QuotedBody } from '@/components/quoted-body';
import { SenderAvatar } from '@/components/sender-avatar';
import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiFetch } from '@/lib/api';
import { replyCc } from '@/lib/compose';
import { formatListTime, formatMessageTime } from '@/lib/format';
import { key } from '@/lib/query';
import type { Message, MessagesResponse } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

interface NameLookup {
  /** A real display name, or null. Feeding a derived one to `rowInitials` would
   *  letter the same correspondent differently here than in the list. */
  nameOf: (address: string) => string | null;
  /** Best label to print: a real name, else the address made readable. */
  person: (address: string) => string;
  inbox: (address: string) => string;
}

/**
 * A sender's display name, when the local part plausibly is one.
 *
 * Returns null rather than guessing: title-casing an opaque local part turns
 * `noreply-a7f3@` into "Noreply A7f3", which is worse than the address itself.
 */
function nameFromAddress(address: string): string | null {
  const words = (address.split('@')[0] ?? '').split(/[._-]+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return null;
  if (!words.every((word) => /^\p{L}+$/u.test(word))) return null;
  return words
    .map((word) => {
      // Only an all-caps part is folded, so a deliberate "JSmith" survives.
      const base = word === word.toUpperCase() ? word.toLowerCase() : word;
      return base[0].toUpperCase() + base.slice(1);
    })
    .join(' ');
}

/** Reply prefixes stack ("Re: Fwd: Re: x"), so strip them repeatedly. */
function subjectKey(subject: string | null | undefined): string {
  return (subject ?? '')
    .replace(/^(?:\s*(?:re|fwd?|aw|sv)\s*:\s*)+/i, '')
    .trim()
    .toLowerCase();
}

// `displayMode` is per inbox and set server-side, so one account can have both
// chat and thread conversations. This screen renders either.
export default function ThreadScreen() {
  const c = useTheme();
  const { personId, type } = useLocalSearchParams<{ personId: string; type?: string }>();
  const router = useRouter();
  const server = useActiveServer();
  const isGroup = type === 'group';

  const query = useQuery({
    queryKey: key(server?.id ?? 'none', 'thread', personId, type),
    enabled: !!server,
    queryFn: () =>
      apiFetch<MessagesResponse>(
        server!.id,
        isGroup
          ? `/api/conversations/${encodeURIComponent(personId)}/emails`
          : `/api/emails/by-person/${encodeURIComponent(personId)}`,
      ),
  });

  const queryClient = useQueryClient();
  const unread = query.data?.emails.some((m) => m.isRead === 0) ?? false;
  const marked = useRef(false);

  const markRead = useMutation({
    mutationFn: () =>
      apiFetch(
        server!.id,
        isGroup ? '/api/conversations/mark-read' : '/api/people/mark-read',
        {
          method: 'POST',
          body: isGroup
            ? { conversationIds: [personId] }
            : { personIds: [personId] },
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(server!.id) }),
  });

  // Opening a conversation is reading it. Without this the only way to clear a
  // badge is the list swipe, so an inbox read on the phone stays entirely lit.
  useEffect(() => {
    if (!server || !unread || marked.current) return;
    marked.current = true;
    markRead.mutate();
  }, [server, unread, markRead]);

  const ordered = useMemo(
    () => [...(query.data?.emails ?? [])].sort((a, b) => a.timestamp - b.timestamp),
    [query.data],
  );

  const names = useMemo<NameLookup>(() => {
    // A display name reaches this screen only on a `cc` entry, so a group thread
    // can name a sender that the message rows themselves never identify.
    const people = new Map<string, string>();
    for (const message of query.data?.emails ?? []) {
      for (const entry of message.cc ?? []) {
        const name = entry.name?.trim();
        if (name && entry.email) people.set(entry.email.trim().toLowerCase(), name);
      }
    }

    const boxes = new Map<string, string>();
    for (const inbox of query.data?.inboxes ?? []) {
      const label = inbox.displayName?.trim();
      if (label) boxes.set(inbox.email.trim().toLowerCase(), label);
    }

    const nameOf = (address: string) => people.get(address.trim().toLowerCase()) ?? null;

    return {
      nameOf,
      person: (address) => nameOf(address) ?? nameFromAddress(address) ?? address,
      inbox: (address) => boxes.get(address.trim().toLowerCase()) ?? address,
    };
  }, [query.data]);

  const chatMode = query.data?.inboxes?.[0]?.displayMode === 'chat';
  // Newest *received*, not `ordered.at(-1)`: `POST /api/send/reply/{emailId}`
  // needs an id that arrived, and the last word is often ours.
  const latestInbound = [...ordered]
    .reverse()
    .find((m) => m.type === 'received');

  const correspondent =
    ordered.find((m) => m.type === 'received')?.fromAddress ?? ordered[0]?.toAddress;
  const title = correspondent ? names.person(correspondent) : 'Conversation';

  return (
    <>
      <Stack.Screen options={{ title, headerBackButtonDisplayMode: 'minimal' }} />

      <Stack.Toolbar placement="bottom">
        {latestInbound ? (
          <Stack.Toolbar.Button
            icon="arrowshape.turn.up.left"
            accessibilityLabel="Reply"
            onPress={async () => {
              if (process.env.EXPO_OS === 'ios') {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              router.push({
                pathname: '/compose',
                params: {
                  replyTo: latestInbound.id,
                  // `recipient` is the inbox the mail arrived on, i.e. the
                  // address to send back from.
                  from: latestInbound.recipient ?? '',
                  // Dropping this answers a group thread as a 1:1, and nobody
                  // else ever learns the conversation continued.
                  cc: replyCc(latestInbound),
                },
              });
            }}
          />
        ) : null}
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button
          icon="square.and.pencil"
          accessibilityLabel="New message"
          separateBackground
          onPress={async () => {
            if (process.env.EXPO_OS === 'ios') {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            router.push('/compose');
          }}
        />
      </Stack.Toolbar>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: Spacing.four,
          gap: Spacing.four,
          // Clears the floating reply capsule.
          paddingBottom: Spacing.four + 72,
        }}>
        {query.isLoading ? (
          <ActivityIndicator style={{ marginTop: Spacing.seven }} />
        ) : ordered.length === 0 ? (
          <Text style={{ ...Type.callout, color: c.textSecondary, textAlign: 'center' }}>
            No messages in this conversation.
          </Text>
        ) : (
          ordered.map((message, index) => (
            <MessageCard
              key={`${message.type}:${message.id}`}
              message={message}
              chatMode={chatMode}
              serverId={server!.id}
              names={names}
              // "Re: x" over all eight replies is noise; only a real change earns a heading.
              showSubject={
                subjectKey(message.subject) !== subjectKey(ordered[index - 1]?.subject)
              }
            />
          ))
        )}
      </ScrollView>
    </>
  );
}

function MessageCard({
  message,
  chatMode,
  serverId,
  names,
  showSubject,
}: {
  message: Message;
  chatMode: boolean;
  serverId: string;
  names: NameLookup;
  showSubject: boolean;
}) {
  const c = useTheme();
  const { width } = useWindowDimensions();
  const outbound = message.type === 'sent';
  const state = deliveryState(message);

  const cc = message.cc ?? [];
  const ccLine =
    cc.length > 0
      ? `Cc ${cc.map((entry) => entry.name || entry.email).join(', ')}`
      : null;

  if (chatMode) {
    return (
      <View
        style={{
          alignSelf: outbound ? 'flex-end' : 'flex-start',
          maxWidth: width * 0.82,
          backgroundColor: outbound ? c.outboundBubble : c.backgroundSubtle,
          borderRadius: Radius.xxl,
          borderCurve: 'continuous',
          paddingHorizontal: Spacing.three,
          paddingVertical: Spacing.two,
          gap: Spacing.one,
        }}>
        {ccLine ? (
          <Text numberOfLines={2} style={{ ...Type.caption, color: c.textTertiary }}>
            {ccLine}
          </Text>
        ) : null}
        <QuotedBody message={message} tint={c.text} />
        <AttachmentRow message={message} serverId={serverId} />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-end',
            gap: Spacing.two,
          }}>
          {/* No left border here: a partial edge on a fully rounded bubble reads as a rendering fault. */}
          {state ? <DeliveryBadge state={state} /> : null}
          <Text style={{ ...Type.caption, color: c.textTertiary }}>
            {formatMessageTime(message.timestamp)}
          </Text>
        </View>
      </View>
    );
  }

  // `fromAddress` is ours on a sent row, so the avatar colour also says which
  // inbox answered.
  const senderAddress = message.fromAddress ?? '';
  const senderName = outbound ? 'You' : names.person(senderAddress);
  const toAddress = outbound
    ? (message.toAddress ?? '')
    : (message.recipient ?? message.toAddress ?? '');

  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: Radius.xl,
        borderCurve: 'continuous',
        borderWidth: HAIRLINE,
        borderColor: c.border,
        borderLeftWidth: state ? 3 : HAIRLINE,
        borderLeftColor: state ? deliveryTint(c, state) : c.border,
        padding: Spacing.three,
        gap: Spacing.two,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}>
      <View style={{ flexDirection: 'row', gap: Spacing.three }}>
        <SenderAvatar address={senderAddress} name={outbound ? null : names.nameOf(senderAddress)} />

        <View style={{ flex: 1, gap: Spacing.half }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two }}>
            <Text
              numberOfLines={1}
              style={{ ...Type.headline, flex: 1, color: c.text }}>
              {senderName}
            </Text>
            <Text
              accessibilityLabel={formatMessageTime(message.timestamp)}
              style={{
                ...Type.caption,
                color: c.textTertiary,
                fontVariant: ['tabular-nums'],
              }}>
              {formatListTime(message.timestamp)}
            </Text>
          </View>

          {senderAddress && senderAddress !== senderName ? (
            <Text numberOfLines={1} style={{ ...Type.footnote, color: c.textSecondary }}>
              {senderAddress}
            </Text>
          ) : null}

          {toAddress ? (
            <Text numberOfLines={1} style={{ ...Type.footnote, color: c.textTertiary }}>
              To:{' '}
              <Text style={{ color: c.textSecondary }}>
                {outbound ? toAddress : names.inbox(toAddress)}
              </Text>
            </Text>
          ) : null}

          {ccLine ? (
            <Text numberOfLines={2} style={{ ...Type.footnote, color: c.textTertiary }}>
              {ccLine}
            </Text>
          ) : null}
        </View>
      </View>

      {state ? <DeliveryBadge state={state} /> : null}

      {showSubject && message.subject ? (
        <Text
          selectable
          style={{ ...Type.title, color: c.text, marginTop: Spacing.half }}>
          {message.subject}
        </Text>
      ) : null}

      <QuotedBody message={message} tint={c.text} />
      <AttachmentRow message={message} serverId={serverId} />
    </View>
  );
}
