import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api';
import { isEmail } from '@/lib/mail-text';
import { key } from '@/lib/query';
import { useActiveServer } from '@/lib/use-servers';

/** A row of `GET /api/admin/inboxes`. */
interface AdminInbox {
  email: string;
  displayName: string | null;
  displayMode: 'thread' | 'chat';
  signatureHtml: string | null;
  forwardTo: string | null;
  assignedUserIds: string[];
}

/** A row of `GET /api/admin/users`, of which this screen reads the name. */
interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string | null;
  createdAt: number;
  hasPasskey: boolean;
}

/**
 * The edits in progress for the one open inbox.
 *
 * Empty strings rather than nulls, because a `TextInput` cannot hold null and
 * because "" is precisely what the server reads as "clear this field" — which
 * makes the emptiness of these two fields the thing the delete condition below
 * turns on.
 */
interface Draft {
  displayName: string;
  displayMode: 'thread' | 'chat';
  signatureHtml: string;
  userIds: string[];
}

/** `signatureHtml` is capped by the route's schema; over it the save 400s. */
const MAX_SIGNATURE_LENGTH = 20_000;

/**
 * The inboxes this deployment receives and sends mail as.
 *
 * One inbox opens at a time, in place. A pushed detail screen would be the
 * usual shape, but the back gesture already means "leave inboxes" here, and a
 * second thing for it to mean is how someone ends up losing an unsaved edit by
 * swiping.
 *
 * Two of the four things this screen writes are destructive in a way the
 * request does not look:
 *
 *  - `PATCH` merges over the stored row and, when the merged result is every
 *    field at its default, DELETES the row instead of writing it — answering
 *    200 with those defaults, so destroying a configuration and saving one are
 *    indistinguishable from the response. Clearing the last-named field is
 *    therefore put behind a confirmation that says what it does.
 *  - `PUT .../assignments` replaces the entire set, so a save is authoritative
 *    about people it was never shown. The list is built to send the whole
 *    intended set and says so where the tick boxes are.
 */
export default function InboxesScreen() {
  const c = useTheme();
  const server = useActiveServer();
  const queryClient = useQueryClient();

  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const inboxes = useQuery({
    queryKey: key(server?.id ?? 'none', 'admin', 'inboxes'),
    enabled: !!server,
    queryFn: () => apiFetch<AdminInbox[]>(server!.id, '/api/admin/inboxes'),
  });

  // Assignments are stored as user ids, which are meaningless on screen. A
  // failure here costs the tick boxes and nothing else, so it is reported in
  // place rather than taken as a failure of the screen.
  const users = useQuery({
    queryKey: key(server?.id ?? 'none', 'admin', 'users'),
    enabled: !!server,
    queryFn: () => apiFetch<AdminUser[]>(server!.id, '/api/admin/users'),
  });

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: key(server!.id, 'admin', 'inboxes'),
    });
  }

  const save = useMutation({
    mutationFn: async ({ inbox, draft }: { inbox: AdminInbox; draft: Draft }) => {
      // Sequential, not concurrent: if the identity write is refused there is
      // no reason to have already replaced the inbox's members.
      if (identityChanged(inbox, draft)) {
        await apiFetch(
          server!.id,
          `/api/admin/inboxes/${encodeURIComponent(inbox.email)}`,
          { method: 'PATCH', body: identityBody(draft) },
        );
      }
      if (!sameIds(draft.userIds, inbox.assignedUserIds)) {
        await apiFetch(
          server!.id,
          `/api/admin/inboxes/${encodeURIComponent(inbox.email)}/assignments`,
          { method: 'PUT', body: { userIds: draft.userIds } },
        );
      }
    },
    onSuccess: async () => {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setOpenEmail(null);
      setDraft(null);
      invalidate();
    },
    onError: (error) => Alert.alert('Could not save', failureMessage(error)),
  });

  const stopForwarding = useMutation({
    // Clearing is the only change to `forwardTo` an app may make: a destination
    // installs a standing copy of every future message, so the server takes the
    // clear from a bearer token and refuses the set. The app therefore holds a
    // kill switch it cannot use to arm anything.
    mutationFn: (inbox: AdminInbox) =>
      apiFetch(server!.id, `/api/admin/inboxes/${encodeURIComponent(inbox.email)}`, {
        method: 'PATCH',
        body: { forwardTo: '' },
      }),
    onSuccess: () => invalidate(),
    onError: (error) =>
      Alert.alert('Could not stop forwarding', failureMessage(error)),
  });

  const create = useMutation({
    mutationFn: (email: string) =>
      apiFetch<AdminInbox>(server!.id, '/api/admin/inboxes', {
        method: 'POST',
        body: { email },
      }),
    onSuccess: (created) => {
      invalidate();
      // Straight into the editor: a new inbox has no name, no signature and
      // nobody assigned, so the row it just became says nothing about itself.
      setOpenEmail(created.email);
      setDraft(draftFrom(created));
    },
    onError: (error) => Alert.alert('Could not create inbox', failureMessage(error)),
  });

  function promptCreate() {
    Alert.prompt(
      'New inbox',
      'The address this deployment receives mail at and can send as.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          // Annotated because `AlertButton.onPress` is a union of the plain and
          // login-password prompt callbacks, which infers as `any` here.
          onPress: (value?: string) => {
            const email = (value ?? '').trim().toLowerCase();
            if (!isEmail(email)) {
              Alert.alert('Not an email address', 'Enter an address like sales@example.com.');
              return;
            }
            create.mutate(email);
          },
        },
      ],
      'plain-text',
      '',
      'email-address',
    );
  }

  function toggleOpen(inbox: AdminInbox) {
    if (openEmail === inbox.email) {
      setOpenEmail(null);
      setDraft(null);
      return;
    }
    setOpenEmail(inbox.email);
    setDraft(draftFrom(inbox));
  }

  function confirmStopForwarding(inbox: AdminInbox) {
    // Predicted from the stored row rather than the draft, because that is what
    // this request merges over — anything typed above and not yet saved has no
    // part in it.
    const message = landsOnDefaults({ ...inbox, forwardTo: null })
      ? `Mail arriving for ${inbox.email} will stop being copied to ${inbox.forwardTo}. Nothing else is saved for this inbox, so its configuration is removed rather than updated, and the address stays in this list only if mail has already arrived for it.`
      : `Mail arriving for ${inbox.email} will stop being copied to ${inbox.forwardTo}. Only a browser can set a forwarding address again.`;

    Alert.alert('Stop forwarding?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop forwarding',
        style: 'destructive',
        onPress: () => stopForwarding.mutate(inbox),
      },
    ]);
  }

  function saveOpen(inbox: AdminInbox, draft: Draft) {
    const identity = identityChanged(inbox, draft);
    const willDelete =
      identity &&
      landsOnDefaults({ ...mergedIdentity(draft), forwardTo: inbox.forwardTo });
    const willRevokeEveryone =
      draft.userIds.length === 0 && inbox.assignedUserIds.length > 0;

    const warnings = [
      willDelete
        ? 'Every setting is back to its default, and the server stores nothing for an inbox in that state — this removes its configuration rather than saving it. The address stays in this list only if mail has already arrived for it.'
        : null,
      willRevokeEveryone
        ? `Nobody is ticked, and saving replaces the whole list, so all ${inbox.assignedUserIds.length} of the people who can use this inbox lose it.`
        : null,
    ].filter((line): line is string => line !== null);

    if (warnings.length === 0) {
      save.mutate({ inbox, draft });
      return;
    }

    Alert.alert(
      willDelete ? 'Remove this inbox’s settings?' : 'Revoke everyone?',
      warnings.join('\n\n'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          style: 'destructive',
          onPress: () => save.mutate({ inbox, draft }),
        },
      ],
    );
  }

  const rows = inboxes.data ?? [];
  const open = rows.find((row) => row.email === openEmail) ?? null;
  const dirty =
    !!open &&
    !!draft &&
    (identityChanged(open, draft) || !sameIds(draft.userIds, open.assignedUserIds));

  if (!server) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: Spacing.six,
        }}>
        <Text
          style={{
            ...Type.callout,
            color: c.textSecondary,
            textAlign: 'center',
          }}>
          No server is selected.
        </Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Inboxes', headerLargeTitle: true }} />

      {/*
        The app's bar, unchanged in shape: the contextual action on the left —
        here the save for whichever inbox is open — and the thing that creates
        something on the right, detached.
      */}
      <Stack.Toolbar placement="bottom">
        {open && draft ? (
          <Stack.Toolbar.Button
            icon="checkmark"
            accessibilityLabel={`Save changes to ${open.email}`}
            disabled={!dirty || save.isPending}
            onPress={() => saveOpen(open, draft)}
          />
        ) : null}
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button
          icon="plus"
          accessibilityLabel="New inbox"
          separateBackground
          disabled={create.isPending}
          onPress={promptCreate}
        />
      </Stack.Toolbar>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          padding: Spacing.four,
          gap: Spacing.five,
          // Clears the floating toolbar, which otherwise sits on the last row.
          paddingBottom: Spacing.four + 72,
        }}
        refreshControl={
          <RefreshControl
            refreshing={inboxes.isRefetching}
            onRefresh={() => inboxes.refetch()}
          />
        }>
        {inboxes.isLoading ? <ActivityIndicator /> : null}

        {inboxes.isError ? <Note>{failureMessage(inboxes.error)}</Note> : null}

        {rows.length > 0 ? (
          <Card>
            {rows.map((inbox, i) => (
              <View key={inbox.email}>
                {i > 0 ? <Divider /> : null}
                <InboxSummary
                  inbox={inbox}
                  open={inbox.email === openEmail}
                  onPress={() => toggleOpen(inbox)}
                />
                {inbox.email === openEmail && draft ? (
                  <>
                    <Divider />
                    <Editor
                      inbox={inbox}
                      draft={draft}
                      onChange={(patch) =>
                        setDraft((current) =>
                          current ? { ...current, ...patch } : current,
                        )
                      }
                      users={users.data ?? null}
                      usersFailed={users.isError}
                      onStopForwarding={() => confirmStopForwarding(inbox)}
                    />
                  </>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        {!inboxes.isLoading && !inboxes.isError ? (
          <Note>
            {rows.length === 0
              ? 'No inboxes yet. Create one for every address this deployment should receive mail at.'
              : 'Every address that has received mail here is listed, configured or not. Tap one to edit it.'}
          </Note>
        ) : null}

        {save.isPending || stopForwarding.isPending ? <ActivityIndicator /> : null}
      </ScrollView>
    </>
  );
}

function draftFrom(inbox: AdminInbox): Draft {
  return {
    displayName: inbox.displayName ?? '',
    displayMode: inbox.displayMode,
    signatureHtml: inbox.signatureHtml ?? '',
    userIds: [...inbox.assignedUserIds],
  };
}

/** Exactly the three fields an app may write, in the form the route expects. */
function identityBody(draft: Draft) {
  return {
    displayName: draft.displayName.trim(),
    displayMode: draft.displayMode,
    signatureHtml: draft.signatureHtml.trim(),
  };
}

/**
 * `identityBody` as the server will store it: "" becomes null, and null is the
 * distinction the delete condition turns on. The signature is sanitized on the
 * way in as well, but that only ever rewrites one string into another — it
 * cannot produce the null that would take the row with it.
 */
function mergedIdentity(draft: Draft) {
  const body = identityBody(draft);
  return {
    displayName: body.displayName === '' ? null : body.displayName,
    displayMode: body.displayMode,
    signatureHtml: body.signatureHtml === '' ? null : body.signatureHtml,
  };
}

/**
 * The server's delete condition, restated.
 *
 * `PATCH /api/admin/inboxes/{email}` merges the body over the stored row and,
 * when the result is name null, mode "chat", signature null and forwardTo null,
 * deletes the `sender_identities` row rather than writing it — then answers 200
 * with those same defaults. Nothing in the response distinguishes that from an
 * ordinary save, so the only place the difference can be shown is before the
 * request leaves.
 *
 * Deliberately compares against null rather than trimming: the server compares
 * against null too, and a stored " " is a value it keeps.
 */
function landsOnDefaults(next: {
  displayName: string | null;
  displayMode: 'thread' | 'chat';
  signatureHtml: string | null;
  forwardTo: string | null;
}): boolean {
  return (
    next.displayName === null &&
    next.displayMode === 'chat' &&
    next.signatureHtml === null &&
    next.forwardTo === null
  );
}

/** True when saving would change what is stored. */
function identityChanged(inbox: AdminInbox, draft: Draft): boolean {
  const body = identityBody(draft);
  return (
    body.displayName !== (inbox.displayName ?? '') ||
    body.displayMode !== inbox.displayMode ||
    body.signatureHtml !== (inbox.signatureHtml ?? '')
  );
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function failureMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong.';
  if (error.kind === 'forbidden') return 'Your account is not an admin on this server.';
  if (error.kind === 'insufficient-scope') {
    return 'This app was not granted admin permission on this server. Sign out and connect it again.';
  }
  if (error.kind === 'network') return 'Cannot reach your server.';
  return error.message;
}

function InboxSummary({
  inbox,
  open,
  onPress,
}: {
  inbox: AdminInbox;
  open: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  const assigned = inbox.assignedUserIds.length;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${open ? 'Close' : 'Edit'} ${inbox.email}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.three,
        padding: Spacing.three,
        backgroundColor: pressed ? c.backgroundSelected : 'transparent',
      })}>
      {/* The address leads: it is the inbox's identity, and the display name is
          a setting on it — one an unconfigured inbox does not have at all. */}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ ...Type.body, color: c.text }}>
          {inbox.email}
        </Text>
        <Text
          numberOfLines={1}
          style={{ ...Type.footnote, color: c.textSecondary }}>
          {inbox.displayName || 'No name'} ·{' '}
          {inbox.displayMode === 'thread' ? 'Thread' : 'Chat'} ·{' '}
          {assigned === 1 ? '1 person' : `${assigned} people`}
          {inbox.signatureHtml ? ' · Signature' : ''}
        </Text>
      </View>
      {inbox.forwardTo ? (
        <Image
          source="sf:arrow.turn.up.right"
          tintColor={c.warning}
          style={{ width: 15, height: 15 }}
        />
      ) : null}
      <Image
        source={open ? 'sf:chevron.up' : 'sf:chevron.down'}
        tintColor={c.textTertiary}
        style={{ width: 12, height: 12 }}
      />
    </Pressable>
  );
}

function Editor({
  inbox,
  draft,
  onChange,
  users,
  usersFailed,
  onStopForwarding,
}: {
  inbox: AdminInbox;
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  users: AdminUser[] | null;
  usersFailed: boolean;
  onStopForwarding: () => void;
}) {
  const c = useTheme();

  function pickMode() {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'How this inbox reads',
        message:
          'Thread keeps subjects and quoted history. Chat drops them and shows bubbles.',
        options: ['Thread', 'Chat', 'Cancel'],
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) onChange({ displayMode: 'thread' });
        if (index === 1) onChange({ displayMode: 'chat' });
      },
    );
  }

  function toggleUser(id: string) {
    onChange({
      userIds: draft.userIds.includes(id)
        ? draft.userIds.filter((current) => current !== id)
        : [...draft.userIds, id],
    });
  }

  // Ids this list has no row for stay in the draft rather than being filtered
  // out of it. The save replaces the whole set, so dropping an id it cannot
  // draw would revoke an assignment the operator was never shown.
  const hidden = users
    ? draft.userIds.filter((id) => !users.some((user) => user.id === id)).length
    : 0;

  return (
    <View>
      <Field label="Name">
        <TextInput
          value={draft.displayName}
          onChangeText={(displayName) => onChange({ displayName })}
          placeholder="Shown as the sender"
          placeholderTextColor={c.textTertiary}
          autoCapitalize="words"
          style={{ ...Type.body, color: c.text, flex: 1, padding: 0 }}
        />
      </Field>

      <Divider />

      <Field label="Reads as" onPress={pickMode}>
        <Text style={{ ...Type.body, color: c.text, flex: 1 }}>
          {draft.displayMode === 'thread' ? 'Thread' : 'Chat'}
        </Text>
      </Field>

      <Divider />

      <Block label="Signature">
        <TextInput
          value={draft.signatureHtml}
          onChangeText={(signatureHtml) => onChange({ signatureHtml })}
          placeholder="<p>Alex — Acme Support</p>"
          placeholderTextColor={c.textTertiary}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={MAX_SIGNATURE_LENGTH}
          scrollEnabled={false}
          style={{
            ...Type.footnote,
            color: c.text,
            minHeight: 72,
            padding: 0,
            textAlignVertical: 'top',
          }}
        />
        <Text style={{ ...Type.caption, color: c.textTertiary }}>
          HTML this app adds to the end of messages sent from this address.
          Scripts, styles and event handlers are stripped when it is saved.
        </Text>
      </Block>

      <Divider />

      <Block label="Forwarding">
        {inbox.forwardTo ? (
          <>
            <Text selectable style={{ ...Type.body, color: c.text }}>
              {inbox.forwardTo}
            </Text>
            <Text style={{ ...Type.caption, color: c.textTertiary }}>
              Every message arriving here is copied to that address.
            </Text>
            <Pressable
              onPress={onStopForwarding}
              accessibilityRole="button"
              style={{ paddingTop: Spacing.one }}>
              <Text style={{ ...Type.subhead, fontWeight: '600', color: c.danger }}>
                Stop forwarding
              </Text>
            </Pressable>
          </>
        ) : (
          <Text style={{ ...Type.body, color: c.textSecondary }}>Not forwarding</Text>
        )}
        {/*
          Read-only on purpose, and said rather than shown as a disabled field:
          a forwarding address is a standing relay of all future inbound mail,
          so the server accepts it only from a browser session and refuses it
          from any app. Clearing one is always allowed.
        */}
        <Text style={{ ...Type.caption, color: c.textTertiary }}>
          A forwarding address is set in the web admin in a browser. Apps may
          clear one but never set one.
        </Text>
      </Block>

      <Divider />

      <Block label="Who can use this inbox">
        {usersFailed ? (
          <Text style={{ ...Type.footnote, color: c.textSecondary }}>
            Could not load the people on this server, so assignments cannot be
            changed here. {inbox.assignedUserIds.length} assigned.
          </Text>
        ) : !users ? (
          <ActivityIndicator />
        ) : users.length === 0 ? (
          <Text style={{ ...Type.footnote, color: c.textSecondary }}>
            Nobody has an account on this server yet.
          </Text>
        ) : (
          users.map((user) => (
            <Pressable
              key={user.id}
              onPress={() => toggleUser(user.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.userIds.includes(user.id) }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: Spacing.three,
                paddingVertical: Spacing.two,
                opacity: pressed ? 0.6 : 1,
              })}>
              <View style={{ flex: 1, gap: 1 }}>
                <Text numberOfLines={1} style={{ ...Type.body, color: c.text }}>
                  {user.name || user.email}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ ...Type.caption, color: c.textSecondary }}>
                  {user.email}
                  {user.role === 'admin' ? ' · Admin' : ''}
                </Text>
              </View>
              {draft.userIds.includes(user.id) ? (
                <Image
                  source="sf:checkmark"
                  tintColor={c.primary}
                  style={{ width: 17, height: 17 }}
                />
              ) : null}
            </Pressable>
          ))
        )}

        <Text style={{ ...Type.caption, color: c.textTertiary }}>
          Saving replaces the whole list: everyone ticked keeps access, everyone
          unticked loses it, and ticking nobody revokes access for everyone.
          {hidden > 0
            ? ` ${hidden} assigned ${hidden === 1 ? 'account is' : 'accounts are'} not in this list, and ${hidden === 1 ? 'it stays' : 'they stay'} assigned.`
            : ''}
        </Text>
      </Block>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: Radius.xl,
        borderCurve: 'continuous',
        overflow: 'hidden',
      }}>
      {children}
    </View>
  );
}

function Divider() {
  const c = useTheme();
  return <View style={{ height: HAIRLINE, backgroundColor: c.border }} />;
}

function Note({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return (
    <Text
      style={{
        ...Type.footnote,
        color: c.textTertiary,
        paddingHorizontal: Spacing.one,
      }}>
      {children}
    </Text>
  );
}

/**
 * One row: a fixed-width label, then the control.
 *
 * The label column is a fixed width rather than intrinsic so the values line up
 * down one edge; with intrinsic widths each row starts its value at a different
 * x and the rows read as unrelated things.
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
        paddingHorizontal: Spacing.three,
        paddingVertical: Spacing.three,
      }}>
      <Text style={{ ...Type.body, color: c.textSecondary, width: 84 }}>
        {label}
      </Text>
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

/** A stacked row, for the controls an 84pt label column cannot sit beside. */
function Block({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={{ padding: Spacing.three, gap: Spacing.two }}>
      <Text style={{ ...Type.footnote, fontWeight: '600', color: c.textSecondary }}>
        {label}
      </Text>
      {children}
    </View>
  );
}
