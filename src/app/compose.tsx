import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { deleteDraft, getDraft, isBlank, saveDraft } from '@/lib/drafts';
import { key } from '@/lib/query';
import type { Inbox } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

/**
 * How long the composer waits after a keystroke before writing.
 *
 * Long enough that a burst of typing is one write, short enough that the pause
 * to think has already committed the sentence before it.
 */
const AUTOSAVE_MS = 600;

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
    draftId?: string;
  }>();

  /**
   * The stored draft this screen resumed, read exactly once.
   *
   * From here on the composer is the only writer of that row, so reading it
   * again on a later render would hand the fields back whatever the autosave
   * last wrote instead of what is being typed.
   */
  const [resumed] = useState(() =>
    params.draftId ? getDraft(params.draftId) : null,
  );

  // A resumed reply is still a reply: which message is being answered belongs
  // to the draft, not to how this screen was opened.
  const replyToEmailId = resumed?.replyToEmailId ?? params.replyTo ?? null;
  const isReply = !!replyToEmailId;

  const inboxes = useQuery({
    queryKey: key(server?.id ?? 'none', 'inboxes'),
    enabled: !!server,
    queryFn: () => apiFetch<Inbox[]>(server!.id, '/api/inboxes'),
  });

  const [draft, setDraft] = useState<Draft>({
    to: resumed?.to ?? params.to ?? '',
    cc: resumed?.cc ?? '',
    from: resumed?.from ?? params.from ?? '',
    subject: resumed?.subject ?? params.subject ?? '',
    body: resumed?.body ?? '',
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
  const blank = isBlank(draft);
  // Still holding exactly what it was opened with. Only a resumed draft can be
  // in this state, and it is worth detecting: opening one is not editing it,
  // and writing the row back would restamp it to now and move it to the top of
  // the list for having been read.
  const unchanged =
    !!resumed &&
    draft.to === resumed.to &&
    draft.cc === resumed.cc &&
    draft.subject === resumed.subject &&
    draft.body === resumed.body &&
    from === resumed.from;

  /**
   * The stored row this composer owns, and whether it still owns one.
   *
   * Refs rather than state: neither is rendered, and a save that re-rendered
   * would restart the very debounce that produced it. `abandoned` is the one
   * that earns its keep — a queued save outlives the decision to throw the
   * draft away, so without it the message writes itself back into the drafts
   * list a moment after the user watched it leave.
   */
  const rowId = useRef(params.draftId);
  const abandoned = useRef(false);

  const saveNow = useCallback(() => {
    if (!server || abandoned.current || unchanged) return;
    // Emptying the composer empties the list too. The row holds text that no
    // longer exists, and keeping it would mean the only way to be rid of
    // something already deleted is to delete it a second time.
    if (blank) {
      if (rowId.current) {
        deleteDraft(rowId.current);
        rowId.current = undefined;
      }
      return;
    }
    rowId.current = saveDraft({
      id: rowId.current,
      serverId: server.id,
      to: draft.to,
      cc: draft.cc,
      from,
      subject: draft.subject,
      body: draft.body,
      replyToEmailId,
      replyToLabel: resumed?.replyToLabel ?? null,
    });
  }, [blank, draft, from, replyToEmailId, resumed, server, unchanged]);

  /**
   * Autosave.
   *
   * Carrying the id is what keeps this to a single row — `saveDraft` upserts on
   * it — so the delay is about write volume rather than row count: the store is
   * synchronous SQLite, and a write per keystroke lands on the thread between
   * the key being pressed and the character appearing.
   */
  useEffect(() => {
    const timer = setTimeout(saveNow, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [saveNow]);

  /** Give up the stored row: the message has either left or been thrown away. */
  const forget = () => {
    abandoned.current = true;
    if (rowId.current) deleteDraft(rowId.current);
  };

  const send = useMutation({
    mutationFn: () =>
      sendDraft(
        server!.id,
        { ...draft, from },
        selected,
        replyToEmailId ?? undefined,
      ),
    onSuccess: async (result) => {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      // Everything the send touched: the thread it lands in and the inbox list
      // whose ordering and preview it changes.
      queryClient.invalidateQueries({ queryKey: key(server!.id) });

      // A 201 is not the same as delivered. The route answers 201 for every
      // outcome it can describe and puts the outcome in `status`, so treating
      // the HTTP code as the answer reports "sent" for mail that was rejected,
      // queued, or deliberately withheld. Each one is handled by name, and the
      // draft is kept on screen whenever the message did not actually leave —
      // dismissing the composer would discard the only copy of it.
      if (result.status === 'failed') {
        Alert.alert(
          'Not sent',
          'The mail provider rejected this message. If this server has no outbound provider configured yet, sending will fail until one is set up.',
        );
        return;
      }
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
      // Only here, where the message has either gone or is queued to go. The
      // two outcomes above returned with the composer still open, so their text
      // stays in the drafts list to be fixed and sent again.
      forget();
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
    if (blank) {
      // Nothing typed: there is nothing to keep and nothing to throw away, so
      // the sheet would be a question with only one honest answer.
      router.back();
      return;
    }
    // Mail's three options, which this screen can finally offer all of: before
    // there was a draft store, "Save Draft" would have been a button that lost
    // the message it promised to keep.
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Delete Draft', 'Save Draft', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 2) return;
        if (index === 0) forget();
        // Written now rather than on the next tick of the autosave: the screen
        // is about to unmount and take the pending timer with it.
        else saveNow();
        router.back();
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
      {/*
        The title tracks the subject as it is typed, as Mail's does. The subject
        field is the first thing to scroll away once the keyboard is up, and
        after that the title is the only place the message says what it is
        about.
      */}
      <Stack.Screen
        options={{
          title: draft.subject.trim() || (isReply ? 'Reply' : 'New message'),
        }}
      />

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

        {/*
          Where the caret starts. A new message wants the first field it does
          not already know the answer to; a reply or a resumed draft wants the
          body, which is the only part still being written.
        */}
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
              autoFocus={!resumed && !params.to}
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
              autoFocus={!resumed && !!params.to}
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
          autoFocus={isReply || !!resumed}
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

        {problem && !blank ? (
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
