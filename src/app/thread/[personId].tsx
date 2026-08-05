import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { MessageBody } from '@/components/message-body';
import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiFetch } from '@/lib/api';
import { formatMessageTime } from '@/lib/format';
import { key } from '@/lib/query';
import type { Message, MessagesResponse } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

/**
 * One conversation.
 *
 * Renders both shapes the inbox can produce. A `person` row is a timeline with
 * one correspondent and comes from `/api/emails/by-person`; a `group` row is a
 * multi-participant thread from `/api/conversations/{id}/emails`. They differ
 * only in where the messages come from, so everything below this fetch is
 * shared.
 *
 * Each inbox is configured `thread` or `chat` server-side and this honours it:
 * chat strips subjects and uses bubbles, thread keeps them. The same screen has
 * to do both because a user's inboxes can disagree.
 */
export default function ThreadScreen() {
  const c = useTheme();
  const { personId, type } = useLocalSearchParams<{ personId: string; type?: string }>();
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

  const messages = query.data?.emails ?? [];
  // Oldest first, so the newest message is where the scroll lands.
  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  const chatMode = query.data?.inboxes?.[0]?.displayMode === 'chat';

  const title =
    ordered.find((m) => m.type === 'received')?.fromAddress ??
    ordered[0]?.toAddress ??
    'Conversation';

  return (
    <>
      <Stack.Screen options={{ title, headerBackButtonDisplayMode: 'minimal' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: Spacing.four, gap: Spacing.four }}>
        {query.isLoading ? (
          <ActivityIndicator style={{ marginTop: Spacing.seven }} />
        ) : ordered.length === 0 ? (
          <Text style={{ ...Type.callout, color: c.textSecondary, textAlign: 'center' }}>
            No messages in this conversation.
          </Text>
        ) : (
          ordered.map((message) => (
            <MessageCard key={`${message.type}:${message.id}`} message={message} chatMode={chatMode} />
          ))
        )}
      </ScrollView>
    </>
  );
}

function MessageCard({ message, chatMode }: { message: Message; chatMode: boolean }) {
  const c = useTheme();
  const { width } = useWindowDimensions();
  const outbound = message.type === 'sent';

  if (chatMode) {
    return (
      <View
        style={{
          alignSelf: outbound ? 'flex-end' : 'flex-start',
          maxWidth: width * 0.82,
          backgroundColor: outbound ? c.primary : c.backgroundSubtle,
          borderRadius: Radius.xxl,
          borderCurve: 'continuous',
          paddingHorizontal: Spacing.three,
          paddingVertical: Spacing.two,
          gap: Spacing.one,
        }}>
        <MessageBody message={message} tint={outbound ? c.onPrimary : c.text} />
        <Text
          style={{
            ...Type.caption,
            color: outbound ? c.onPrimary : c.textTertiary,
            opacity: outbound ? 0.7 : 1,
            alignSelf: 'flex-end',
          }}>
          {formatMessageTime(message.createdAt)}
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
          {formatMessageTime(message.createdAt)}
        </Text>
      </View>
      <MessageBody message={message} tint={c.text} />
    </View>
  );
}
