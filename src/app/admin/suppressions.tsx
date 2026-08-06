import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
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

import { AdminGate } from '@/components/admin-gate';
import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api';
import { formatMessageTime } from '@/lib/format';
import { isEmail } from '@/lib/mail-text';
import { key } from '@/lib/query';
import type { Me } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

/** `SuppressionSchema` from the worker's suppressions router. */
interface Suppression {
  id: string;
  email: string;
  /** `unsubscribe` is the recipient's own decision; `manual` is an operator's. */
  reason: 'unsubscribe' | 'manual';
  /** `admin:<email>`, `one-click` or `user-link` on rows this deployment wrote. */
  source: string | null;
  note: string | null;
  /** Epoch seconds, like every other timestamp this API returns. */
  createdAt: number;
}

/**
 * One page of `GET /api/suppressions`, newest first. `nextCursor` is the last
 * row's `createdAt` and the comparison it feeds is exclusive, so a row sharing
 * that second with a page boundary is dropped rather than duplicated. Not
 * fixable from the client.
 */
interface SuppressionPage {
  items: Suppression[];
  nextCursor: string | null;
}

export default function SuppressionsScreen() {
  const c = useTheme();
  const server = useActiveServer();
  const queryClient = useQueryClient();

  const [address, setAddress] = useState('');

  // Same key as the admin hub's, so arriving from it is a cache hit. Asking at
  // all because server.role is a sign-in snapshot that may be missing.
  const me = useQuery({
    queryKey: key(server?.id ?? 'none', 'me'),
    enabled: !!server,
    queryFn: () => apiFetch<Me>(server!.id, '/api/user/me'),
  });
  const role = me.data?.role ?? server?.role ?? null;
  const isAdmin = role === 'admin';

  const query = useInfiniteQuery({
    queryKey: key(server?.id ?? 'none', 'suppressions'),
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

      const existing = alreadyThere(row, rows);
      if (existing) Alert.alert('Already suppressed', existing);
    },
    onError: (error, email) => failed(`Could not suppress ${email}`, error),
  });

  const remove = useMutation({
    // Idempotent: a row somebody else already deleted still answers 200, so a
    // stale id cannot turn into an error alert.
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
      <Stack.Screen options={{ title: 'Suppressions', headerLargeTitle: true }} />

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
        }>
        {!isAdmin ? (
          <AdminGate
            me={me}
            role={role}
            withheld="the suppression list"
            reason="The suppression list decides who this whole deployment will and will not send to, so this server only allows accounts with the admin role to read or change it. Ask an admin on this server if you need one."
          />
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
      // Same sheet on both gestures: nothing else sits behind this row.
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

function describeEntry(row: Suppression): string {
  const verb = row.reason === 'unsubscribe' ? 'Unsubscribed' : 'Added';
  const origin = describeSource(row.source);
  const when = formatMessageTime(row.createdAt);
  return origin ? `${verb} ${origin} · ${when}` : `${verb} ${when}`;
}

/**
 * This deployment writes three values: `admin:<email>`, `one-click`,
 * `user-link`. Anything else is shown verbatim rather than dropped.
 */
function describeSource(source: string | null): string | null {
  if (!source) return null;
  if (source.startsWith('admin:')) return `by ${source.slice('admin:'.length)}`;
  if (source === 'one-click') return 'with one click';
  if (source === 'user-link') return 'from the link in a message';
  return `via ${source}`;
}

/**
 * `POST /api/suppressions` answers 201 when it wrote a row and 200 when it found
 * one, with an identical body; `apiFetch` returns the body only, so the status
 * never reaches here. The route only ever writes `reason: "manual"`, so any
 * other reason predates the request. Returns null when neither signal fires
 * rather than guessing.
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
  return reason;
}

function rankOf(reason: string): number {
  if (reason === 'manual') return 0;
  if (reason === 'unsubscribe') return 1;
  return 2;
}

/**
 * Grouped, not partitioned into the two known reasons: filtering would hide a
 * row whose reason this app does not recognise, and it is still suppressed.
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
    // No sort within a group: the API returns newest first and pages concatenate
    // in order.
    .map(([reason, items]) => ({ title: titleOf(reason), rows: items }));
}

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

/** Keeps the server's own sentence: only some of its refusals are worth a retry. */
async function failed(title: string, error: unknown): Promise<void> {
  if (process.env.EXPO_OS === 'ios') {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
  Alert.alert(title, error instanceof ApiError ? error.message : 'Something went wrong.');
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

/** The label width is fixed, not intrinsic, so values line up down one edge. */
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
