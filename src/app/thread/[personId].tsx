import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
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

  const messages = query.data?.emails ?? [];
  // Oldest first, so the newest message is where the scroll lands.
  const ordered = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const chatMode = query.data?.inboxes?.[0]?.displayMode === 'chat';
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

      {/*
        The same grammar as the inbox: contextual action on the left, compose
        detached on the right. Mail does this too — its compose button stays in
        the corner on the message screen as well as the list, so "write
        something new" is never more than one tap from anywhere. Keeping the
        two bars structurally identical means the corner your thumb has learned
        does not change meaning when you open a conversation.

        Reply targets the newest *received* message, not the newest message.
        `POST /api/send/reply/{emailId}` needs something that arrived, and
        taking `ordered.at(-1)` blindly hands it a sent id whenever the last
        word was yours — which in a support mailbox is most of the time. Its
        `recipient` is the inbox the mail came in on, so passing it opens the
        composer on the address the sender actually wrote to rather than on
        whichever identity happens to sort first.

        Deliberately no trash. Mail's message view can offer one because it is
        showing exactly one message; this screen is a whole timeline with a
        person, so a bin here would have to mean either "this conversation" or
        "this person" and the icon cannot say which.
      */}
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
                  from: latestInbound.recipient ?? '',
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
          // Clears the floating reply capsule, which otherwise sits on top of
          // the last message rather than below it.
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
          backgroundColor: outbound ? c.outboundBubble : c.backgroundSubtle,
          borderRadius: Radius.xxl,
          borderCurve: 'continuous',
          paddingHorizontal: Spacing.three,
          paddingVertical: Spacing.two,
          gap: Spacing.one,
        }}>
        <MessageBody message={message} tint={c.text} />
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
      </View>
      <MessageBody message={message} tint={c.text} />
    </View>
  );
}
