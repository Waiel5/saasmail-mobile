import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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

import { AdminGate } from '@/components/admin-gate';
import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api';
import { formatListTime } from '@/lib/format';
import { isEmail } from '@/lib/mail-text';
import { key } from '@/lib/query';
import type { Me } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

/** `BlockRuleSchema` from the worker's blocklist router. */
interface BlockRule {
  id: string;
  /** "email" blocks one sender; "domain" blocks every address at a domain. */
  type: 'email' | 'domain';
  /** Stored trimmed and lowercased, so not necessarily what was typed. */
  value: string;
  note: string | null;
  /** The address of whoever added it. Null for rules written by a script. */
  createdBy: string | null;
  /** Epoch seconds, like every other timestamp this API returns. */
  createdAt: number;
}

/** One page of `GET /api/blocklist`, newest first. */
interface BlockPage {
  items: BlockRule[];
  /** The `createdAt` of the last item, or null at the end of the list. */
  nextCursor: string | null;
}

/** What `DELETE /api/blocklist/mail` reports once it has finished. */
interface PurgeResult {
  emailsDeleted: number;
  peopleDeleted: number;
}

const PURGE_PHRASE = 'DELETE';

export default function BlocklistScreen() {
  const c = useTheme();
  const server = useActiveServer();
  const queryClient = useQueryClient();

  const [type, setType] = useState<'email' | 'domain'>('email');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  // The POST is idempotent and its two outcomes are not the same news; see
  // `foundRatherThanMade`.
  const [outcome, setOutcome] = useState<{ rule: BlockRule; existed: boolean } | null>(
    null,
  );

  // server.role is a sign-in snapshot and may be missing entirely, so an admin
  // would read as "not an admin" without asking again.
  const me = useQuery({
    queryKey: key(server?.id ?? 'none', 'me'),
    enabled: !!server,
    queryFn: () => apiFetch<Me>(server!.id, '/api/user/me'),
  });
  const role = me.data?.role ?? server?.role ?? null;
  const isAdmin = role === 'admin';

  const rules = useInfiniteQuery({
    queryKey: key(server?.id ?? 'none', 'blocklist'),
    enabled: !!server && isAdmin,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiFetch<BlockPage>(
        server!.id,
        pageParam
          ? `/api/blocklist?cursor=${encodeURIComponent(pageParam)}`
          : '/api/blocklist',
      ),
    getNextPageParam: (page) => page.nextCursor,
  });

  const loaded = rules.data?.pages.flatMap((page) => page.items) ?? [];
  const myEmail = me.data?.email ?? server?.userEmail ?? null;

  function invalidateRules() {
    queryClient.invalidateQueries({ queryKey: key(server!.id, 'blocklist') });
  }

  /**
   * The whole server, not just the blocklist: mail lists and search filter
   * against these rules, and cached pages stay fresh for 30 seconds with no
   * refetch on focus, so a narrower invalidation leaves a blocked sender on
   * screen.
   */
  function invalidateEverything() {
    queryClient.invalidateQueries({ queryKey: key(server!.id) });
  }

  const add = useMutation({
    mutationFn: async () => {
      // Captured before the request: afterwards the rule is on the list either
      // way and the comparison is worthless.
      const before = loaded;
      const rule = await apiFetch<BlockRule>(server!.id, '/api/blocklist', {
        method: 'POST',
        body: {
          type,
          value: value.trim(),
          // Omitted, not sent empty: "" would be stored as the note.
          note: note.trim() || undefined,
        },
      });
      return { rule, existed: foundRatherThanMade(rule, before, myEmail) };
    },
    onSuccess: async (result) => {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(
          result.existed
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Success,
        );
      }
      setOutcome(result);
      setValue('');
      setNote('');
      if (result.existed) invalidateRules();
      else invalidateEverything();
    },
    onError: async (error) => {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      Alert.alert('Could not block', failureMessage(error));
    },
  });

  const unblock = useMutation({
    mutationFn: (rule: BlockRule) =>
      apiFetch<{ deleted: true }>(
        server!.id,
        `/api/blocklist/${encodeURIComponent(rule.id)}`,
        { method: 'DELETE' },
      ),
    onSuccess: async (_result, rule) => {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      if (outcome?.rule.id === rule.id) setOutcome(null);
      invalidateEverything();
    },
    onError: (error, rule) =>
      Alert.alert(`Could not unblock ${rule.value}`, failureMessage(error)),
  });

  const purge = useMutation({
    mutationFn: () =>
      apiFetch<PurgeResult>(server!.id, '/api/blocklist/mail', { method: 'DELETE' }),
    onSuccess: async (result) => {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      invalidateEverything();
      Alert.alert('Mail deleted', purgeSummary(result));
    },
    onError: (error) =>
      // Never "nothing was deleted": the purge is an untransacted loop over
      // senders, so a failure part-way leaves some mail already gone.
      Alert.alert(
        'Could not finish deleting',
        `${failureMessage(error)}\n\nSome mail may already have been deleted. Pull to refresh, then check the list before trying again.`,
      ),
  });

  function pickType() {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'What to block',
        message:
          'An address blocks one sender. A domain blocks every address at it, including senders nobody on this deployment has heard from yet.',
        options: ['Address', 'Domain', 'Cancel'],
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) setType('email');
        if (index === 1) setType('domain');
        if (index < 2) setOutcome(null);
      },
    );
  }

  function confirmUnblock(rule: BlockRule) {
    Alert.alert(
      `Unblock ${rule.value}?`,
      `${describeReach(rule)} will be delivered to this deployment again, and anything received from ${rule.type === 'domain' ? 'that domain' : 'that address'} before it was blocked reappears in the inboxes it arrived in. Mail refused while the rule was in place was never stored, and does not come back.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          style: 'destructive',
          onPress: () => unblock.mutate(rule),
        },
      ],
    );
  }

  function openActions(rule: BlockRule) {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: rule.value,
        message: `${describeReach(rule)} is refused on arrival. Added ${byline(rule)}.`,
        options: ['Unblock', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) confirmUnblock(rule);
      },
    );
  }

  function confirmPurge() {
    const scope =
      rules.hasNextPage || !rules.isSuccess
        ? 'every rule on this list'
        : loaded.length === 1
          ? 'the one rule on this list'
          : `all ${loaded.length} rules on this list`;

    Alert.alert(
      'Delete mail from blocked senders?',
      `This permanently deletes every stored message from every sender matched by ${scope} — in every inbox on this deployment, not only the ones you read — along with their attachments, any replies this server sent back to them, and their contact entries.\n\nThere is no preview of what it will take, and it cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: promptPurge },
      ],
    );
  }

  function promptPurge() {
    Alert.prompt(
      `Type ${PURGE_PHRASE} to confirm`,
      'Nothing is sent until this matches. The deletion covers every inbox on this deployment and cannot be reversed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete mail',
          style: 'destructive',
          // Annotated because `AlertButton.onPress` unions the plain and
          // login-password callbacks, and infers as `any` here.
          onPress: (typed?: string) => {
            if ((typed ?? '').trim().toUpperCase() !== PURGE_PHRASE) {
              Alert.alert(
                'Nothing was deleted',
                `That did not match ${PURGE_PHRASE}, so no request was sent. Every message from every blocked sender is still where it was.`,
              );
              return;
            }
            purge.mutate();
          },
        },
      ],
      'plain-text',
      '',
    );
  }

  const trimmed = value.trim().toLowerCase();
  const problem = !trimmed
    ? type === 'email'
      ? 'Enter the address to block.'
      : 'Enter the domain to block.'
    : type === 'email'
      ? isEmail(trimmed)
        ? null
        : 'That does not look like an email address.'
      : trimmed.includes('@')
        ? 'A domain rule takes the bare domain — spammer.com, not name@spammer.com.'
        : trimmed.includes('.')
          ? null
          : 'Enter a bare domain, like spammer.com.';

  const domains = loaded.filter((rule) => rule.type === 'domain');
  const addresses = loaded.filter((rule) => rule.type === 'email');
  // `isSuccess` is load-bearing: provably empty, not merely not loaded yet.
  const nothingBlocked = rules.isSuccess && loaded.length === 0;

  // Reachable by signing out of the last account with this screen open.
  if (!server) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: Spacing.six,
        }}>
        <Text style={{ ...Type.callout, color: c.textSecondary, textAlign: 'center' }}>
          No server is selected.
        </Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Blocklist', headerLargeTitle: true }} />

      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.Spacer />
        {isAdmin ? (
          <Stack.Toolbar.Button
            icon="hand.raised"
            accessibilityLabel="Block this sender"
            accessibilityHint={problem ?? undefined}
            separateBackground
            disabled={!!problem || add.isPending}
            onPress={() => add.mutate()}
          />
        ) : null}
      </Stack.Toolbar>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentContainerStyle={
          isAdmin
            ? {
                padding: Spacing.four,
                gap: Spacing.five,
                // Clears the floating toolbar, which otherwise sits on the last row.
                paddingBottom: Spacing.four + 72,
              }
            : // The gate is a SwiftUI host, and a host given no height renders nothing.
              { flexGrow: 1 }
        }
        refreshControl={
          <RefreshControl
            refreshing={rules.isRefetching}
            onRefresh={() => rules.refetch()}
          />
        }>
        {!isAdmin ? (
          <AdminGate
            me={me}
            role={role}
            withheld="the blocklist"
            reason="The blocklist is one list for the whole deployment — it decides whose mail reaches every inbox here, and it can delete what has already arrived — so this server only allows accounts with the admin role to change it. Ask an admin on this server if you need one."
          />
        ) : (
          <>
            <Section title="Block a sender">
              <Card>
                <Field label="Block" onPress={pickType}>
                  <Text style={{ ...Type.body, color: c.text, flex: 1 }}>
                    {type === 'email' ? 'An address' : 'A domain'}
                  </Text>
                </Field>
                <Divider />
                <Field label={type === 'email' ? 'Address' : 'Domain'}>
                  <TextInput
                    value={value}
                    onChangeText={(next) => {
                      setValue(next);
                      setOutcome(null);
                    }}
                    placeholder={type === 'email' ? 'name@spammer.com' : 'spammer.com'}
                    placeholderTextColor={c.textTertiary}
                    keyboardType={type === 'email' ? 'email-address' : 'url'}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    onSubmitEditing={() => {
                      if (!problem) add.mutate();
                    }}
                    style={{ ...Type.body, color: c.text, flex: 1, padding: 0 }}
                  />
                </Field>
                <Divider />
                <Field label="Note">
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="Why, for the next admin"
                    placeholderTextColor={c.textTertiary}
                    autoCapitalize="sentences"
                    style={{ ...Type.body, color: c.text, flex: 1, padding: 0 }}
                  />
                </Field>
              </Card>

              {trimmed && problem ? <Note>{problem}</Note> : null}

              {outcome ? (
                <Text
                  style={{
                    ...Type.footnote,
                    color: outcome.existed ? c.warning : c.textSecondary,
                    paddingHorizontal: Spacing.one,
                  }}>
                  {outcome.existed
                    ? `${outcome.rule.value} was already blocked — added ${byline(outcome.rule)}. Nothing changed.`
                    : `${outcome.rule.value} is blocked. ${describeReach(outcome.rule)} is refused from now on; anything already received is hidden, not deleted.`}
                </Text>
              ) : null}

              <Note>
                Rules belong to the server, not to your account: they filter every
                inbox on this deployment and every admin sees the same list. The
                server refuses a rule that would block one of its own addresses or
                its own sending domain.
              </Note>

              {add.isPending ? <ActivityIndicator /> : null}
            </Section>

            {rules.isLoading ? <ActivityIndicator /> : null}
            {rules.isError ? <Note>{failureMessage(rules.error)}</Note> : null}

            {domains.length > 0 ? (
              <Section title="Domains">
                <Card>
                  {domains.map((rule, i) => (
                    <View key={rule.id}>
                      {i > 0 ? <Divider /> : null}
                      <RuleRow rule={rule} onPress={() => openActions(rule)} />
                    </View>
                  ))}
                </Card>
                <Note>
                  Each of these blocks every address at that domain, including
                  senders nobody here has heard from yet.
                </Note>
              </Section>
            ) : null}

            {addresses.length > 0 ? (
              <Section title="Addresses">
                <Card>
                  {addresses.map((rule, i) => (
                    <View key={rule.id}>
                      {i > 0 ? <Divider /> : null}
                      <RuleRow rule={rule} onPress={() => openActions(rule)} />
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}

            {loaded.length > 0 ? (
              <Note>
                Tap a rule to unblock it. Mail refused while a rule was in place was
                never stored, so unblocking brings back only what arrived before it.
              </Note>
            ) : null}

            {nothingBlocked ? (
              <Note>
                Nothing is blocked on this deployment. Every sender that writes to an
                inbox here is delivered.
              </Note>
            ) : null}

            {rules.hasNextPage ? (
              <View style={{ alignItems: 'center' }}>
                <Pressable
                  onPress={() => rules.fetchNextPage()}
                  accessibilityRole="button"
                  disabled={rules.isFetchingNextPage}
                  style={{
                    paddingHorizontal: Spacing.five,
                    paddingVertical: Spacing.two,
                    borderRadius: Radius.full,
                    borderCurve: 'continuous',
                    backgroundColor: c.backgroundSubtle,
                  }}>
                  <Text style={{ ...Type.subhead, fontWeight: '600', color: c.text }}>
                    {rules.isFetchingNextPage ? 'Loading…' : 'Load older rules'}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <Section title="Hidden mail">
              <Card>
                <View style={{ padding: Spacing.three, gap: Spacing.two }}>
                  <Text style={{ ...Type.headline, color: c.text }}>
                    Delete mail from blocked senders
                  </Text>
                  <Text style={{ ...Type.footnote, color: c.textSecondary }}>
                    Blocking hides the mail that arrived before the rule; it does not
                    remove it, and removing the rule brings it back. This deletes it
                    instead — every stored message from every blocked sender, in every
                    inbox on this deployment, with its attachments, the replies this
                    server sent back, and the sender’s contact entry.
                  </Text>
                  <Text style={{ ...Type.footnote, color: c.textSecondary }}>
                    There is no preview and no undo.
                  </Text>
                  <Pressable
                    onPress={confirmPurge}
                    accessibilityRole="button"
                    accessibilityLabel="Delete mail from blocked senders"
                    accessibilityHint={
                      nothingBlocked
                        ? 'Nothing is blocked, so there is nothing to delete'
                        : 'Asks twice, and the second confirmation must be typed'
                    }
                    disabled={nothingBlocked || purge.isPending}
                    style={({ pressed }) => ({
                      marginTop: Spacing.one,
                      paddingVertical: Spacing.three,
                      borderRadius: Radius.lg,
                      borderCurve: 'continuous',
                      alignItems: 'center',
                      backgroundColor: nothingBlocked
                        ? c.backgroundSubtle
                        : pressed
                          ? c.danger
                          : c.dangerSubtle,
                    })}>
                    {({ pressed }) => (
                      <Text
                        style={{
                          ...Type.subhead,
                          fontWeight: '600',
                          color: nothingBlocked
                            ? c.textTertiary
                            : pressed
                              ? c.background
                              : c.danger,
                        }}>
                        {purge.isPending ? 'Deleting…' : 'Delete mail permanently'}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </Card>

              <Note>
                {nothingBlocked
                  ? 'Nothing is blocked, so this would match no mail.'
                  : 'Mail from senders you unblock later cannot be recovered once this has run.'}
              </Note>

              {purge.isPending ? <ActivityIndicator /> : null}
            </Section>
          </>
        )}
      </ScrollView>
    </>
  );
}

/**
 * The POST answers 201 for a new rule and 200 for an existing one, with an
 * identical body; `apiFetch` returns the body only, so the status never reaches
 * here and the answer is reconstructed from the row itself.
 */
function foundRatherThanMade(
  rule: BlockRule,
  known: BlockRule[],
  myEmail: string | null,
): boolean {
  if (known.some((existing) => existing.id === rule.id)) return true;
  return (
    !!myEmail &&
    !!rule.createdBy &&
    rule.createdBy.toLowerCase() !== myEmail.trim().toLowerCase()
  );
}

/** Reads as the subject of a sentence; callers append the verb. */
function describeReach(rule: BlockRule): string {
  return rule.type === 'domain'
    ? `Mail from every address at ${rule.value}`
    : `Mail from ${rule.value}`;
}

function byline(rule: BlockRule): string {
  const when = formatListTime(rule.createdAt);
  return rule.createdBy ? `by ${rule.createdBy} · ${when}` : when;
}

function purgeSummary(result: PurgeResult): string {
  if (result.emailsDeleted === 0 && result.peopleDeleted === 0) {
    return 'No stored mail matched a blocked sender, so nothing was deleted.';
  }
  const messages =
    result.emailsDeleted === 1 ? '1 message' : `${result.emailsDeleted} messages`;
  const senders =
    result.peopleDeleted === 1 ? '1 sender' : `${result.peopleDeleted} senders`;
  // `emailsDeleted` counts received messages only; the replies this server sent
  // are deleted in the same pass and never counted.
  return `${messages} from ${senders} are gone, with their attachments. Replies this server sent to those addresses were deleted too, and are not in that count.`;
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

function RuleRow({ rule, onPress }: { rule: BlockRule; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      // Same sheet on both gestures: nothing else sits behind this row.
      onLongPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${rule.value}, blocked`}
      accessibilityHint="Shows what you can do to this rule"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.three,
        padding: Spacing.three,
        backgroundColor: pressed ? c.backgroundSelected : 'transparent',
      })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ ...Type.body, color: c.text }}>
          {rule.value}
        </Text>
        {rule.note ? (
          <Text numberOfLines={2} style={{ ...Type.footnote, color: c.textSecondary }}>
            {rule.note}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={{ ...Type.caption, color: c.textTertiary }}>
          {byline(rule)}
        </Text>
      </View>
      <Image
        source={rule.type === 'domain' ? 'sf:globe' : 'sf:envelope'}
        tintColor={c.textTertiary}
        style={{ width: 15, height: 15 }}
      />
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ gap: Spacing.two }}>
      <Text
        style={{
          ...Type.caption,
          fontWeight: '600',
          color: c.textTertiary,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          paddingHorizontal: Spacing.one,
        }}>
        {title}
      </Text>
      {children}
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

/** The label width is fixed, not intrinsic, so values line up down one edge. */
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
      <Text style={{ ...Type.body, color: c.textSecondary, width: 72 }}>{label}</Text>
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
