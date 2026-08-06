import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { AttachmentRow } from '@/components/attachment-row';
import { MessageBody } from '@/components/message-body';
import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiFetch } from '@/lib/api';
import { replyCc } from '@/lib/compose';
import { formatMessageTime } from '@/lib/format';
import { key } from '@/lib/query';
import type { Message, MessagesResponse } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

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

  const messages = query.data?.emails ?? [];
  const ordered = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const chatMode = query.data?.inboxes?.[0]?.displayMode === 'chat';
  // Newest *received*, not `ordered.at(-1)`: `POST /api/send/reply/{emailId}`
  // needs an id that arrived, and the last word is often ours.
  const latestInbound = [...ordered]
    .reverse()
    .find((m) => m.type === 'received');

  const title =
    ordered.find((m) => m.type === 'received')?.fromAddress ??
    ordered[0]?.toAddress ??
    'Conversation';

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
          ordered.map((message) => (
            <MessageCard
              key={`${message.type}:${message.id}`}
              message={message}
              chatMode={chatMode}
              serverId={server!.id}
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
}: {
  message: Message;
  chatMode: boolean;
  serverId: string;
}) {
  const c = useTheme();
  const { width } = useWindowDimensions();
  const outbound = message.type === 'sent';
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
        <MessageBody message={message} tint={c.text} />
        <AttachmentRow message={message} serverId={serverId} />
        <Text
          style={{
            ...Type.caption,
            color: c.textTertiary,
            alignSelf: 'flex-end',
          }}>
          {formatMessageTime(message.timestamp)}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: Radius.xl,
        borderCurve: 'continuous',
        borderWidth: HAIRLINE,
        borderColor: c.border,
        padding: Spacing.three,
        gap: Spacing.two,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}>
      <View style={{ gap: 2 }}>
        <Text selectable style={{ ...Type.headline, color: c.text }}>
          {message.subject || '(no subject)'}
        </Text>
        <Text style={{ ...Type.footnote, color: c.textSecondary }}>
          {outbound ? `To ${message.toAddress ?? ''}` : `From ${message.fromAddress ?? ''}`}
          {' · '}
          {formatMessageTime(message.timestamp)}
        </Text>
        {ccLine ? (
          <Text numberOfLines={2} style={{ ...Type.footnote, color: c.textSecondary }}>
            {ccLine}
          </Text>
        ) : null}
      </View>
      <MessageBody message={message} tint={c.text} />
      <AttachmentRow message={message} serverId={serverId} />
    </View>
  );
}
