import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
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
import { formatMessageTime } from '@/lib/format';
import { isEmail } from '@/lib/mail-text';
import { key } from '@/lib/query';
import type { Me } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

/**
 * `SuppressionSchema` from the worker's suppressions router.
 *
 * `reason` is the whole story of the row: `unsubscribe` is the recipient's own
 * decision, recorded when they used the link saasmail appends to outbound mail;
 * `manual` is an operator's, written by the route this screen posts to.
 */
interface Suppression {
  id: string;
  email: string;
  reason: 'unsubscribe' | 'manual';
  /** `admin:<email>`, `one-click` or `user-link` on rows this deployment wrote. */
  source: string | null;
  note: string | null;
  /** Epoch seconds, like every other timestamp this API returns. */
  createdAt: number;
}

/**
 * One page of `GET /api/suppressions`, newest first.
 *
 * `nextCursor` is the `createdAt` of the last row as a string, and the comparison
 * it feeds is exclusive — so a row sharing that second with the last row of a
 * page is never returned rather than returned twice. Nothing this screen can
 * correct from the client. It is written down because this list is the evidence
 * somebody uses to explain a message that did not arrive, and at a page boundary
 * it can be one row short of the truth.
 */
interface SuppressionPage {
  items: Suppression[];
  nextCursor: string | null;
}

/**
 * The addresses this server refuses to send to.
 *
 * This is the screen that answers "I sent it and nothing happened". A send to a
 * suppressed address is not attempted and not recorded — the route still answers
 * 201, with the outcome in `status`, so from the caller's side the request
 * succeeded and the mail simply never existed. The composer reports that as "Not
 * delivered"; this is where the reason lives, so the explanation is stated on the
 * screen rather than left to be inferred from a list of addresses.
 *
 * Grouped by reason rather than carrying a reason column, because the two groups
 * are not the same kind of entry: one is a decision the recipient made and the
 * other is one an operator made, and that difference is what makes removing a
 * row either routine or something to think twice about.
 */
export default function SuppressionsScreen() {
  const c = useTheme();
  const server = useActiveServer();
  const queryClient = useQueryClient();

  const [address, setAddress] = useState('');

  // Same key as the admin hub's, so arriving from it needs no request at all.
  // The stored role is only a snapshot taken at sign-in and the identity fetch
  // is allowed to fail there, which is why the hub asks again and why this
  // screen reads its answer instead of trusting the snapshot alone.
  const me = useQuery({
    queryKey: key(server?.id ?? 'none', 'me'),
    enabled: !!server,
    queryFn: () => apiFetch<Me>(server!.id, '/api/user/me'),
  });
  const role = me.data?.role ?? server?.role ?? null;
  const isAdmin = role === 'admin';

  const query = useInfiniteQuery({
    queryKey: key(server?.id ?? 'none', 'suppressions'),
    // Waiting for the role costs an admin nothing — `server.role` resolves
    // synchronously in the common case — and spares a member a request that
    // exists only to be refused.
    enabled: !!server && isAdmin,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiFetch<SuppressionPage>(
        server!.id,
        pageParam
          ? `/api/suppressions?cursor=${encodeURIComponent(pageParam)}`
          : '/api/suppressions',
      ),
    getNextPageParam: (last) => last.nextCursor,
  });

  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const sections = useMemo(() => groupByReason(rows), [rows]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: key(server!.id, 'suppressions') });

  const add = useMutation({
    mutationFn: (email: string) =>
      apiFetch<Suppression>(server!.id, '/api/suppressions', {
        method: 'POST',
        body: { email },
      }),
    onSuccess: async (row) => {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setAddress('');
      invalidate();

      // Nothing is said when the row is new: it appears at the top of the list a
      // moment later, and an alert confirming what the screen already shows is
      // noise. A row that was already there is worth interrupting for, because
      // the operator asked for a change and got none.
      const existing = alreadyThere(row, rows);
      if (existing) Alert.alert('Already suppressed', existing);
    },
    onError: (error, email) => failed(`Could not suppress ${email}`, error),
  });

  const remove = useMutation({
    // Idempotent server-side: a row somebody else already deleted still answers
    // 200, so a stale id from this list cannot turn into an error alert.
    mutationFn: (row: Suppression) =>
      apiFetch<{ deleted: true }>(
        server!.id,
        `/api/suppressions/${encodeURIComponent(row.id)}`,
        { method: 'DELETE' },
      ),
    onSuccess: async () => {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      invalidate();
    },
    onError: (error, row) => failed(`Could not remove ${row.email}`, error),
  });

  function confirmRemove(row: Suppression) {
    // Both messages name the address and say plainly that mail resumes, because
    // that is the consequence — the row is small, what it was holding back is
    // not. An unsubscribe additionally names whose decision is being reversed:
    // removing it does not restore a default, it overrides a person.
    const message =
      row.reason === 'unsubscribe'
        ? `${row.email} asked to stop receiving mail on ${formatMessageTime(row.createdAt)}. Removing this entry reverses that and this server will send to them again. Do it only if they have asked you to.`
        : `This server will send to ${row.email} again. ${describeEntry(row)}.`;

    Alert.alert(`Remove ${row.email}?`, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(row) },
    ]);
  }

  function openActions(row: Suppression) {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: row.email,
        message: describeEntry(row),
        options: ['Remove from the list', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) confirmRemove(row);
      },
    );
  }

  const trimmed = address.trim();
  const problem = !trimmed
    ? 'Enter the address to suppress.'
    : !isEmail(trimmed)
      ? 'That does not look like an email address.'
      : null;

  // Reachable by signing out of the last account while this screen is open.
  // Everything below addresses a specific server by id.
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
      <Stack.Screen options={{ title: 'Suppressions', headerLargeTitle: true }} />

      {/*
        The create action in the detached right slot, exactly where the invite
        screen puts its own. Nothing occupies the left: this screen has one verb.
        Absent rather than disabled for a member, because the form it submits is
        not on their screen either and a lone dimmed button offers no reading of
        why.
      */}
      {isAdmin ? (
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.Spacer />
          <Stack.Toolbar.Button
            icon="nosign"
            accessibilityLabel="Suppress this address"
            accessibilityHint={problem ?? undefined}
            separateBackground
            disabled={!!problem || add.isPending}
            onPress={() => add.mutate(trimmed)}
          />
        </Stack.Toolbar>
      ) : null}

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        refreshControl={
          isAdmin ? (
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => query.refetch()}
            />
          ) : undefined
        }
        contentContainerStyle={{
          padding: Spacing.four,
          gap: Spacing.five,
          // Clears the floating toolbar, which otherwise sits on the last row.
          paddingBottom: Spacing.four + 72,
        }}>
        {!isAdmin ? (
          me.isLoading ? (
            <ActivityIndicator style={{ marginTop: Spacing.seven }} />
          ) : (
            <NotAnAdmin />
          )
        ) : (
          <>
            <Section title="Suppress an address">
              <Card>
                <Field label="Address">
                  <TextInput
                    value={address}
                    onChangeText={setAddress}
                    placeholder="name@example.com"
                    placeholderTextColor={c.textTertiary}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onSubmitEditing={() => {
                      if (!problem) add.mutate(trimmed);
                    }}
                    style={{ ...Type.body, color: c.text, flex: 1, padding: 0 }}
                  />
                </Field>
              </Card>

              {trimmed && problem ? <Note>{problem}</Note> : null}

              {/*
                The whole point of the screen, said once and in the operator's
                own terms. Every clause is a behaviour of `lib/send.ts`: the
                suppression check runs before the transport, the send route
                answers 201 whatever the outcome, and a suppressed To cancels
                the message including its Cc recipients.
              */}
              <Note>
                This server will not send to an address on this list. The message is
                cancelled before it reaches the mail provider and nothing is written to
                the thread, but the send still answers 201 with{' '}
                <Text style={{ color: c.text }}>status: “suppressed”</Text> — so from
                the sending side nothing failed and nothing arrived. That is what the
                composer reports as “Not delivered”.
              </Note>

              <Note>
                A suppressed address in To cancels the whole message, Cc recipients
                included. A suppressed address in Cc is dropped on its own and the rest
                of the message still goes.
              </Note>

              {add.isPending ? <ActivityIndicator /> : null}
            </Section>

            {sections.map((section) => (
              <Section key={section.title} title={section.title}>
                <Card>
                  {section.rows.map((row, i) => (
                    <View key={row.id}>
                      {i > 0 ? <Divider /> : null}
                      <SuppressionRow row={row} onPress={() => openActions(row)} />
                    </View>
                  ))}
                </Card>
              </Section>
            ))}

            {query.isLoading ? <ActivityIndicator /> : null}

            {query.hasNextPage ? (
              <Pressable
                onPress={() => query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                accessibilityRole="button"
                style={{
                  alignSelf: 'center',
                  paddingHorizontal: Spacing.five,
                  paddingVertical: Spacing.two,
                  borderRadius: Radius.full,
                  backgroundColor: c.backgroundSubtle,
                }}>
                <Text style={{ ...Type.subhead, fontWeight: '600', color: c.text }}>
                  {query.isFetchingNextPage ? 'Loading…' : 'Load older entries'}
                </Text>
              </Pressable>
            ) : null}

            <Note>
              {query.error
                ? explainFailure(query.error)
                : rows.length === 0
                  ? query.isLoading
                    ? 'Loading the list…'
                    : 'No addresses are suppressed, so this is not why a message went missing — every recipient this server is asked to mail is one it will try to deliver to.'
                  : 'Tap an address for actions. Sends marked transactional bypass this list entirely, so a receipt or a password reset still reaches a suppressed address.'}
            </Note>
          </>
        )}
      </ScrollView>
    </>
  );
}

function SuppressionRow({ row, onPress }: { row: Suppression; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      // Both gestures open the same sheet. Nothing sits behind this row, so a
      // tap that did nothing would be the only thing most people ever discover.
      onLongPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Shows what you can do to this entry"
      style={({ pressed }) => ({
        padding: Spacing.three,
        gap: 2,
        backgroundColor: pressed ? c.backgroundSelected : 'transparent',
      })}>
      <Text numberOfLines={1} style={{ ...Type.body, color: c.text }}>
        {row.email}
      </Text>
      <Text style={{ ...Type.footnote, color: c.textSecondary }}>
        {describeEntry(row)}
      </Text>
      {row.note ? (
        <Text style={{ ...Type.footnote, color: c.textTertiary }}>{row.note}</Text>
      ) : null}
    </Pressable>
  );
}

/**
 * When the entry arrived and where from, in one line.
 *
 * The reason is the section header above the row, so it is not repeated here —
 * only its verb, which is what carries the date.
 */
function describeEntry(row: Suppression): string {
  const verb = row.reason === 'unsubscribe' ? 'Unsubscribed' : 'Added';
  const origin = describeSource(row.source);
  const when = formatMessageTime(row.createdAt);
  return origin ? `${verb} ${origin} · ${when}` : `${verb} ${when}`;
}

/**
 * `source` in words.
 *
 * Three values are written by this deployment: `admin:<email>` by the route this
 * screen posts to, `one-click` and `user-link` by the unsubscribe route.
 * Anything else is shown verbatim rather than dropped — it is the only record of
 * where the entry came from, and a row whose origin this app cannot name is
 * exactly the row an operator most wants the origin of.
 */
function describeSource(source: string | null): string | null {
  if (!source) return null;
  if (source.startsWith('admin:')) return `by ${source.slice('admin:'.length)}`;
  if (source === 'one-click') return 'with one click';
  if (source === 'user-link') return 'from the link in a message';
  return `via ${source}`;
}

/**
 * Why the address was already suppressed, or null when it was not.
 *
 * `POST /api/suppressions` is idempotent on the address: 201 when it wrote a row,
 * 200 when it found one. `apiFetch` resolves to the parsed body rather than the
 * response, so the status code never reaches here and the difference has to come
 * out of the row itself. Two signals cannot be wrong — this route only ever
 * writes `reason: "manual"`, so any other reason predates the request, and an id
 * already on screen cannot have been minted by it. Neither firing means only that
 * this cannot be proven, so nothing is claimed: the address is suppressed either
 * way, which is what the operator asked for.
 */
function alreadyThere(row: Suppression, listed: Suppression[]): string | null {
  const known = listed.some((existing) => existing.id === row.id);
  if (row.reason !== 'unsubscribe' && !known) return null;

  return row.reason === 'unsubscribe'
    ? `${row.email} was already on the list — they unsubscribed on ${formatMessageTime(row.createdAt)}. Nothing changed.`
    : `${row.email} was already on the list. ${describeEntry(row)}. Nothing changed.`;
}

interface ReasonSection {
  title: string;
  rows: Suppression[];
}

function titleOf(reason: string): string {
  if (reason === 'manual') return 'Added by an admin';
  if (reason === 'unsubscribe') return 'Unsubscribed';
  // A reason this app has not heard of keeps its own name, the way an unknown
  // role does on the people screen. Filing it under a familiar heading would
  // make the header a guess about who decided this.
  return reason;
}

/** Operator decisions first: they are the ones this screen can safely undo. */
function rankOf(reason: string): number {
  if (reason === 'manual') return 0;
  if (reason === 'unsubscribe') return 1;
  return 2;
}

/**
 * Grouped rather than partitioned into the two known reasons.
 *
 * A filter would drop a row whose reason this app does not recognise, and that
 * address would still be suppressed — a screen whose job is explaining missing
 * mail must not become the thing that hides the explanation.
 */
function groupByReason(rows: Suppression[]): ReasonSection[] {
  const groups = new Map<string, Suppression[]>();
  for (const row of rows) {
    const existing = groups.get(row.reason);
    if (existing) existing.push(row);
    else groups.set(row.reason, [row]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => rankOf(a) - rankOf(b) || a.localeCompare(b))
    // The API returns newest first and the pages are concatenated in order, so
    // each group is already in the order it should be read.
    .map(([reason, items]) => ({ title: titleOf(reason), rows: items }));
}

/**
 * Why the list is missing, in terms the admin can act on.
 *
 * The two that matter are not failures of the request: a missing scope and a
 * missing passkey both mean the call was never going to be made, and both are
 * fixed somewhere other than here.
 */
function explainFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong loading the list.';
  if (error.kind === 'insufficient-scope') {
    return 'This app was not granted admin access on this server. Sign out and connect it again, allowing admin access when your server asks.';
  }
  if (error.kind === 'passkey-required') {
    return 'This account needs a passkey before the app can use it. Open your server in a browser, register one, then pull to refresh.';
  }
  if (error.kind === 'forbidden') {
    return 'Your account is not an admin on this server.';
  }
  if (error.kind === 'network') {
    return 'Cannot reach your server, so the suppression list is not shown.';
  }
  return error.message;
}

/**
 * The server's own words, not a generic failure.
 *
 * A rejected address and a refused scope read nothing alike, and only one of
 * them is worth trying again.
 */
async function failed(title: string, error: unknown): Promise<void> {
  if (process.env.EXPO_OS === 'ios') {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
  Alert.alert(title, error instanceof ApiError ? error.message : 'Something went wrong.');
}

function NotAnAdmin() {
  const c = useTheme();
  return (
    <View
      style={{
        paddingTop: Spacing.seven,
        paddingHorizontal: Spacing.four,
        gap: Spacing.three,
        alignItems: 'center',
      }}>
      <Image source="sf:lock" tintColor={c.textTertiary} style={{ width: 40, height: 40 }} />
      <Text style={{ ...Type.title, color: c.text, textAlign: 'center' }}>Admins only</Text>
      <Text style={{ ...Type.callout, color: c.textSecondary, textAlign: 'center' }}>
        The suppression list decides who this whole deployment will and will not send
        to, so this server only allows accounts with the admin role to read or change
        it. Ask an admin on this server if you need one.
      </Text>
    </View>
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
    <Text style={{ ...Type.footnote, color: c.textTertiary, paddingHorizontal: Spacing.one }}>
      {children}
    </Text>
  );
}

/** One form row: a fixed-width label, then the control. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
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
    </View>
  );
}
