import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { HAIRLINE, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api';
import { draftProblem, sendDraft, type Draft } from '@/lib/compose';
import { key } from '@/lib/query';
import type { Inbox } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

/**
 * Writing a message.
 *
 * One screen serves both a new message and a reply, because they differ in two
 * fields and nothing else: a reply's recipient and subject are decided by the
 * message being answered, so it renders them as context rather than as inputs.
 * Splitting them into two screens would duplicate the From picker, the address
 * validation, the send mutation and the discard guard to avoid rendering two
 * rows conditionally.
 *
 * The layout is Mail's: sender and recipient stacked as labelled rows at the
 * top, subject last before a body that takes the rest of the screen. That order
 * is not arbitrary — it is the order the fields are filled in, and it puts the
 * caret in the body without the user tapping anything after the last field.
 */
export default function ComposeScreen() {
  const c = useTheme();
  const router = useRouter();
  const server = useActiveServer();
  const queryClient = useQueryClient();

  const params = useLocalSearchParams<{
    to?: string;
    subject?: string;
    replyTo?: string;
    from?: string;
  }>();
  const isReply = !!params.replyTo;

  const inboxes = useQuery({
    queryKey: key(server?.id ?? 'none', 'inboxes'),
    enabled: !!server,
    queryFn: () => apiFetch<Inbox[]>(server!.id, '/api/inboxes'),
  });

  const [draft, setDraft] = useState<Draft>({
    to: params.to ?? '',
    cc: '',
    from: params.from ?? '',
    subject: params.subject ?? '',
    body: '',
  });
  const options = inboxes.data ?? [];
  // The From address is chosen for the user when there is nothing to choose:
  // an inbox named by the caller, else the only one they have. Leaving it blank
  // and demanding a tap is a step with one possible outcome.
  const from =
    draft.from || (options.length === 1 ? options[0].email : '') || '';
  const selected = useMemo(
    () => options.find((i) => i.email.toLowerCase() === from.toLowerCase()),
    [options, from],
  );

  const problem = draftProblem({ ...draft, from }, isReply);
  const isEmpty =
    !draft.body.trim() && !draft.subject.trim() && !draft.to.trim();

  const send = useMutation({
    mutationFn: () =>
      sendDraft(server!.id, { ...draft, from }, selected, params.replyTo),
    onSuccess: async (result) => {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      // Everything the send touched: the thread it lands in and the inbox list
      // whose ordering and preview it changes.
      queryClient.invalidateQueries({ queryKey: key(server!.id) });

      // "Sent" is not the only success. A transient provider failure is queued
      // and retried, and a suppressed recipient is deliberately not delivered —
      // reporting either as sent is how someone waits on a reply that is never
      // coming.
      if (result.status === 'suppressed') {
        Alert.alert(
          'Not delivered',
          'Every recipient is on this server’s suppression list, so nothing was sent.',
        );
        return;
      }
      if (result.status === 'retrying') {
        Alert.alert(
          'Queued',
          'Your mail provider did not accept the message just now. saasmail has queued it and will retry.',
        );
      }
      router.back();
    },
    onError: async (error) => {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      Alert.alert(
        'Could not send',
        error instanceof ApiError
          ? error.message
          : 'Something went wrong sending this message.',
      );
    },
  });

  const discard = () => {
    if (isEmpty) {
      router.back();
      return;
    }
    // Mail offers "save as draft" here. saasmail has no draft storage, so
    // offering it would be a button that loses the message it promised to keep.
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Delete draft', 'Keep writing'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
        title: 'This message has not been sent.',
      },
      (index) => {
        if (index === 0) router.back();
      },
    );
  };

  const pickFrom = () => {
    if (options.length < 2) return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Send from',
        options: [...options.map(labelFor), 'Cancel'],
        cancelButtonIndex: options.length,
      },
      (index) => {
        if (index < options.length) {
          setDraft((d) => ({ ...d, from: options[index].email }));
        }
      },
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: isReply ? 'Reply' : 'New message' }} />

      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={discard}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>

      {/*
        A real bar button, not a drawn one: `prominent` is what gives it the
        filled circular treatment Mail's send button has, from the system rather
        than from a stylesheet that would have to be re-tuned every iOS release.

        Disabled rather than hidden while the draft is incomplete — a button
        that vanishes leaves nothing to explain the absence, and `problem`
        already knows exactly what is missing, so it becomes the hint.
      */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="arrow.up"
          variant="prominent"
          accessibilityLabel="Send"
          accessibilityHint={problem ?? undefined}
          disabled={!!problem || send.isPending || !server}
          onPress={() => send.mutate()}
        />
      </Stack.Toolbar>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        // The native keyboard inset, rather than a KeyboardAvoidingView
        // wrapper: the body field grows as it is typed into, and the JS
        // approach measures a frame that has already moved.
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentContainerStyle={{ paddingBottom: Spacing.seven }}>
        <Field label="From" onPress={options.length > 1 ? pickFrom : undefined}>
          {inboxes.isLoading ? (
            <ActivityIndicator />
          ) : (
            <Text
              numberOfLines={1}
              style={{ ...Type.body, color: from ? c.text : c.textTertiary }}>
              {selected ? labelFor(selected) : from || 'No sending address'}
            </Text>
          )}
        </Field>

        {isReply ? null : (
          <Field label="To">
            <TextInput
              value={draft.to}
              onChangeText={(to) => setDraft((d) => ({ ...d, to }))}
              placeholder="name@example.com"
              placeholderTextColor={c.textTertiary}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={!params.to}
              style={{ ...Type.body, color: c.text, flex: 1, padding: 0 }}
            />
          </Field>
        )}

        {/*
          Always shown rather than hidden behind a "Cc/Bcc" disclosure as Mail
          does. Mail earns the disclosure by having Bcc and a From picker to
          hide alongside it; here it would conceal a single optional row behind
          a tap, and a row nobody uses costs one line of screen — a row nobody
          can find costs the message.
        */}
        <Field label="Cc">
          <TextInput
            value={draft.cc}
            onChangeText={(cc) => setDraft((d) => ({ ...d, cc }))}
            placeholder="Optional, comma separated"
            placeholderTextColor={c.textTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ ...Type.body, color: c.text, flex: 1, padding: 0 }}
          />
        </Field>

        {isReply ? null : (
          <Field label="Subject">
            <TextInput
              value={draft.subject}
              onChangeText={(subject) => setDraft((d) => ({ ...d, subject }))}
              placeholder="Subject"
              placeholderTextColor={c.textTertiary}
              autoFocus={!!params.to}
              style={{ ...Type.body, color: c.text, flex: 1, padding: 0 }}
            />
          </Field>
        )}

        <TextInput
          value={draft.body}
          onChangeText={(body) => setDraft((d) => ({ ...d, body }))}
          placeholder={isReply ? 'Write a reply…' : 'Write a message…'}
          placeholderTextColor={c.textTertiary}
          multiline
          autoFocus={isReply}
          scrollEnabled={false}
          style={{
            ...Type.body,
            color: c.text,
            paddingHorizontal: Spacing.four,
            paddingTop: Spacing.three,
            // Tall enough that the empty state reads as a writing surface
            // rather than as another one-line field.
            minHeight: 220,
            textAlignVertical: 'top',
          }}
        />

        {problem && !isEmpty ? (
          <Text
            selectable
            style={{
              ...Type.footnote,
              color: c.textSecondary,
              paddingHorizontal: Spacing.four,
              paddingTop: Spacing.two,
            }}>
            {problem}
          </Text>
        ) : null}

        {inboxes.isError ? (
          <Text
            selectable
            style={{
              ...Type.footnote,
              color: c.textSecondary,
              paddingHorizontal: Spacing.four,
              paddingTop: Spacing.two,
            }}>
            Could not load your sending addresses.{' '}
            {inboxes.error instanceof ApiError
              ? inboxes.error.message
              : 'Check your connection.'}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}

/** "Acme Support <support@acme.com>", or just the address when unnamed. */
function labelFor(inbox: Inbox): string {
  return inbox.displayName ? `${inbox.displayName} <${inbox.email}>` : inbox.email;
}

/**
 * One header row: a fixed-width label, a full-width tap target, a hairline.
 *
 * The label column is a fixed width rather than intrinsic so From/To/Cc/Subject
 * align down the left edge — with intrinsic widths each value starts at a
 * different x and the block reads as four unrelated rows.
 */
function Field({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress?: () => void;
  children: React.ReactNode;
}) {
  const c = useTheme();
  const row = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.two,
        paddingHorizontal: Spacing.four,
        paddingVertical: Spacing.three,
        borderBottomWidth: HAIRLINE,
        borderBottomColor: c.border,
      }}>
      <Text style={{ ...Type.body, color: c.textSecondary, width: 62 }}>{label}</Text>
      {children}
      {onPress ? (
        <Image
          source="sf:chevron.up.chevron.down"
          tintColor={c.textTertiary}
          style={{ width: 12, height: 12 }}
        />
      ) : null}
    </View>
  );

  if (!onPress) return row;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {row}
    </Pressable>
  );
}
