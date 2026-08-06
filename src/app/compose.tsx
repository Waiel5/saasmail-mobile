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

const AUTOSAVE_MS = 600;

export default function ComposeScreen() {
  const c = useTheme();
  const router = useRouter();
  const server = useActiveServer();
  const queryClient = useQueryClient();

  const params = useLocalSearchParams<{
    to?: string;
    cc?: string;
    subject?: string;
    replyTo?: string;
    from?: string;
    draftId?: string;
  }>();

  // Read once. The composer is the only writer of this row from here on, so
  // re-reading would hand the fields back whatever autosave last wrote.
  const [resumed] = useState(() =>
    params.draftId ? getDraft(params.draftId) : null,
  );

  const replyToEmailId = resumed?.replyToEmailId ?? params.replyTo ?? null;
  const isReply = !!replyToEmailId;

  const inboxes = useQuery({
    queryKey: key(server?.id ?? 'none', 'inboxes'),
    enabled: !!server,
    queryFn: () => apiFetch<Inbox[]>(server!.id, '/api/inboxes'),
  });

  // Opening state, which is not the same as empty: a reply arrives carrying the
  // Cc roster of the message it answers.
  const [seed] = useState<Draft>(() => ({
    to: resumed?.to ?? params.to ?? '',
    cc: resumed?.cc ?? params.cc ?? '',
    from: resumed?.from ?? params.from ?? '',
    subject: resumed?.subject ?? params.subject ?? '',
    body: resumed?.body ?? '',
  }));
  const [draft, setDraft] = useState<Draft>(seed);
  const options = inboxes.data ?? [];
  // Always defaulted, including when there are several inboxes: a blank From
  // opens the composer with Send disabled and nothing saying why.
  const from =
    draft.from || params.from || options[0]?.email || '';
  const selected = useMemo(
    () => options.find((i) => i.email.toLowerCase() === from.toLowerCase()),
    [options, from],
  );

  const problem = draftProblem({ ...draft, from }, isReply);
  const blank = isBlank(draft);
  // Opening a draft is not editing it: writing the row back unchanged would
  // restamp `updatedAt` and jump it to the top of the drafts list.
  const untouched =
    draft.to === seed.to &&
    draft.cc === seed.cc &&
    draft.subject === seed.subject &&
    draft.body === seed.body &&
    // `draft.from`, never the defaulted `from`: a stored empty From differs
    // from the fallback, so merely opening the row would count as an edit.
    draft.from === seed.from;

  // Refs, not state: a save that re-rendered would restart its own debounce.
  // `abandoned` stops a queued save from resurrecting a discarded draft.
  const rowId = useRef(params.draftId);
  const abandoned = useRef(false);

  const saveNow = useCallback(() => {
    if (!server || abandoned.current) return;
    if (blank) {
      if (rowId.current) {
        deleteDraft(rowId.current);
        rowId.current = undefined;
      }
      return;
    }
    if (untouched) return;
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
  }, [blank, draft, from, replyToEmailId, resumed, server, untouched]);

  // Debounced because the store is synchronous SQLite: a write per keystroke
  // lands on the thread between the key press and the character appearing.
  // `saveDraft` upserts on `rowId`, so this stays one row either way.
  useEffect(() => {
    const timer = setTimeout(saveNow, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [saveNow]);

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
      queryClient.invalidateQueries({ queryKey: key(server!.id) });

      // A 201 is not delivery. The route answers 201 for every outcome it can
      // describe and puts the real one in `status`, so the haptic reads that
      // and not the response; the composer stays open whenever the message did
      // not leave, since it holds the only copy.
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(
          result.status === 'sent'
            ? Haptics.NotificationFeedbackType.Success
            : result.status === 'failed'
              ? Haptics.NotificationFeedbackType.Error
              : Haptics.NotificationFeedbackType.Warning,
        );
      }

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
    // A reply left as it opened holds a Cc roster but nothing of the user's,
    // so there is nothing to ask about.
    if (blank || (!resumed && untouched)) {
      router.back();
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Delete Draft', 'Save Draft', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 2) return;
        if (index === 0) forget();
        // Save now, not on the next autosave tick: the screen is about to
        // unmount and take the pending timer with it.
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
      <Stack.Screen
        options={{
          title: draft.subject.trim() || (isReply ? 'Reply' : 'New message'),
        }}
      />

      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={discard}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>

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
        // Not KeyboardAvoidingView: the body field grows as it is typed into,
        // and the JS approach measures a frame that has already moved.
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
              {selected
                ? labelFor(selected)
                : from ||
                  (inboxes.isSuccess
                    ? 'No address on this server can send'
                    : '')}
            </Text>
          )}
        </Field>

        {/*
          The three `autoFocus` props below are mutually exclusive: whichever
          field is the first one still unanswered takes the caret.
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
            minHeight: 220,
            textAlignVertical: 'top',
          }}
        />

        {problem && !blank && !untouched ? (
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

function labelFor(inbox: Inbox): string {
  return inbox.displayName ? `${inbox.displayName} <${inbox.email}>` : inbox.email;
}

/** The label column is a fixed width so all four rows' values share an x. */
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
