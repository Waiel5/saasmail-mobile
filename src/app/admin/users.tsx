import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useMemo } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from 'react-native';

import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api';
import { key } from '@/lib/query';
import { useActiveServer } from '@/lib/use-servers';

/** A row of `GET /api/admin/users`. */
interface AdminUser {
  id: string;
  name: string;
  email: string;
  /** Null is not "member": better-auth leaves the column unset on old accounts. */
  role: string | null;
  /** Epoch seconds, like every other timestamp this API returns. */
  createdAt: number;
  hasPasskey: boolean;
}

export default function AdminUsersScreen() {
  const router = useRouter();
  const server = useActiveServer();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: key(server?.id ?? 'none', 'admin', 'users'),
    enabled: !!server,
    queryFn: () => apiFetch<AdminUser[]>(server!.id, '/api/admin/users'),
  });

  const users = query.data ?? [];
  const sections = useMemo(() => groupByRole(users), [users]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: key(server!.id, 'admin', 'users') });

  const remove = useMutation({
    mutationFn: (user: AdminUser) =>
      apiFetch<void>(server!.id, `/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      await succeeded();
      invalidate();
    },
    onError: (error, user) => failed(`Could not remove ${nameOf(user)}`, error),
  });

  const demote = useMutation({
    mutationFn: (user: AdminUser) =>
      apiFetch<void>(server!.id, `/api/admin/users/${encodeURIComponent(user.id)}/role`, {
        method: 'PATCH',
        body: { role: 'member' },
      }),
    onSuccess: async () => {
      await succeeded();
      invalidate();
    },
    onError: (error, user) => failed(`Could not change ${nameOf(user)}’s role`, error),
  });

  const confirmRemove = (user: AdminUser) => {
    Alert.alert(
      `Remove ${nameOf(user)}?`,
      `Deleting ${user.email} also deletes their sessions, API keys, passkeys, inbox permissions and push registrations. Mail already in the inboxes is untouched. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(user) },
      ],
    );
  };

  const confirmDemote = (user: AdminUser) => {
    Alert.alert(
      `Make ${nameOf(user)} a member?`,
      `They keep their account, but lose the admin screens. Admins can read every inbox, so afterwards they will see only the inboxes granted to them individually — which may be none.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Make a member', onPress: () => demote.mutate(user) },
      ],
    );
  };

  const openActions = (user: AdminUser) => {
    if (!server) return;

    const actions: { label: string; destructive?: boolean; run: () => void }[] = [];

    if (user.role === 'admin') {
      actions.push({ label: 'Make a member', run: () => confirmDemote(user) });
    } else {
      // No promote action: the server refuses `role: "admin"` from an OAuth
      // token however it is asked.
      actions.push({
        label: 'Make an admin in a browser…',
        run: () => openBrowserAsync(`${server.origin}/admin/users`),
      });
    }

    actions.push({
      label: 'Remove from this server',
      destructive: true,
      run: () => confirmRemove(user),
    });

    const destructive = actions.findIndex((a) => a.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: nameOf(user),
        message: user.name ? user.email : undefined,
        options: [...actions.map((a) => a.label), 'Cancel'],
        cancelButtonIndex: actions.length,
        destructiveButtonIndex: destructive < 0 ? undefined : destructive,
      },
      // Cancel indexes past the end, so there is nothing to run.
      (index) => actions[index]?.run(),
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'People', headerLargeTitle: true }} />

      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.Button
          icon="person.badge.plus"
          accessibilityLabel="Invites"
          onPress={async () => {
            if (process.env.EXPO_OS === 'ios') {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            router.push('/admin/invites');
          }}
        />
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

      <SectionList
        sections={sections}
        keyExtractor={(user) => user.id}
        contentInsetAdjustmentBehavior="automatic"
        ItemSeparatorComponent={RowSeparator}
        contentContainerStyle={{ paddingBottom: Spacing.four + 72 }}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />
        }
        renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
        renderSectionFooter={({ section }) => (section.note ? <Note>{section.note}</Note> : null)}
        renderItem={({ item }) => (
          <UserRow
            user={item}
            // `userId` is absent when the sign-in identity fetch failed; the
            // server refuses to delete or demote the caller either way.
            isSelf={!!server?.userId && item.id === server.userId}
            onPress={() => openActions(item)}
          />
        )}
        ListEmptyComponent={
          query.isLoading ? (
            <View style={{ paddingTop: Spacing.seven, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : (
            <EmptyState error={query.error} onRetry={() => query.refetch()} />
          )
        }
        ListFooterComponent={
          users.length > 0 ? (
            <View style={{ paddingTop: Spacing.four, gap: Spacing.two }}>
              <Note>
                Tap or hold someone for actions. Your own account can only be changed by another
                admin, and only your server’s own admin page in a browser can make someone an
                admin.
              </Note>
              {users.some((u) => !u.hasPasskey) ? (
                <Note>
                  “No passkey” means that account has never registered one, and this server refuses
                  every request it makes until they do — in a browser, on their own device.
                </Note>
              ) : null}
            </View>
          ) : null
        }
      />
    </>
  );
}

function UserRow({
  user,
  isSelf,
  onPress,
}: {
  user: AdminUser;
  isSelf: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Pressable
      disabled={isSelf}
      accessibilityRole="button"
      accessibilityHint="Shows what you can do to this person"
      onPress={onPress}
      // Same sheet on both gestures: nothing else sits behind this row.
      onLongPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? c.backgroundSelected : c.background,
      })}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.three,
          paddingHorizontal: Spacing.four,
          paddingVertical: Spacing.three,
        }}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two }}>
            <Text numberOfLines={1} style={{ ...Type.body, flexShrink: 1, color: c.text }}>
              {nameOf(user)}
            </Text>
            {isSelf ? <Text style={{ ...Type.caption, color: c.textTertiary }}>You</Text> : null}
          </View>
          {user.name ? (
            <Text numberOfLines={1} style={{ ...Type.footnote, color: c.textSecondary }}>
              {user.email}
            </Text>
          ) : null}
        </View>

        {user.hasPasskey ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one }}>
            <Image source="sf:key.slash" tintColor={c.warning} style={{ width: 13, height: 13 }} />
            <Text style={{ ...Type.caption, color: c.warning }}>No passkey</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  const c = useTheme();
  return (
    <Text
      style={{
        ...Type.caption,
        fontWeight: '600',
        color: c.textTertiary,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        paddingHorizontal: Spacing.four,
        paddingTop: Spacing.five,
        paddingBottom: Spacing.two,
        // Section headers stick and rows scroll under them, so this cannot be
        // transparent.
        backgroundColor: c.background,
      }}>
      {title}
    </Text>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return (
    <Text
      style={{
        ...Type.footnote,
        color: c.textTertiary,
        paddingHorizontal: Spacing.four,
        paddingTop: Spacing.two,
      }}>
      {children}
    </Text>
  );
}

function RowSeparator() {
  const c = useTheme();
  return <View style={{ height: HAIRLINE, backgroundColor: c.border, marginLeft: Spacing.four }} />;
}

/** No retry on the scope and passkey cases: the call was never going to be made. */
function EmptyState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const c = useTheme();

  let icon = 'sf:person.2';
  let message = 'Nobody has an account on this server yet.';
  let retry = false;

  if (error instanceof ApiError) {
    icon = 'sf:exclamationmark.triangle';
    if (error.kind === 'insufficient-scope') {
      message =
        'This app was not granted admin access on this server. Sign out and connect it again, allowing admin access when your server asks.';
    } else if (error.kind === 'passkey-required') {
      message =
        'This account needs a passkey before the app can use it. Open your server in a browser, register one, then pull to refresh.';
    } else if (error.kind === 'forbidden') {
      message = 'Your account is not an admin on this server.';
    } else if (error.kind === 'network') {
      icon = 'sf:wifi.slash';
      message = 'Cannot reach your server. Check your connection.';
      retry = true;
    } else {
      message = error.message;
      retry = true;
    }
  }

  return (
    <View
      style={{
        paddingTop: Spacing.seven,
        paddingHorizontal: Spacing.six,
        gap: Spacing.three,
        alignItems: 'center',
      }}>
      <Image source={icon} tintColor={c.textTertiary} style={{ width: 34, height: 34 }} />
      <Text selectable style={{ ...Type.callout, color: c.textSecondary, textAlign: 'center' }}>
        {message}
      </Text>
      {retry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={{
            paddingHorizontal: Spacing.five,
            paddingVertical: Spacing.two,
            borderRadius: Radius.full,
            backgroundColor: c.backgroundSubtle,
          }}>
          <Text style={{ ...Type.subhead, fontWeight: '600', color: c.text }}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface RoleSection {
  title: string;
  note?: string;
  data: AdminUser[];
}

function nameOf(user: AdminUser): string {
  return user.name || user.email;
}

function rankOf(role: string | null): number {
  if (role === 'admin') return 0;
  if (role === 'member') return 1;
  return role === null ? 3 : 2;
}

function titleOf(role: string | null): string {
  if (role === 'admin') return 'Admins';
  if (role === 'member') return 'Members';
  return role ?? 'No role set';
}

function groupByRole(users: AdminUser[]): RoleSection[] {
  const groups = new Map<string | null, AdminUser[]>();
  for (const user of users) {
    // `||`, not `??`: "" is not a role, and it would render as an empty header.
    const role = user.role || null;
    const existing = groups.get(role);
    if (existing) existing.push(user);
    else groups.set(role, [user]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => rankOf(a) - rankOf(b) || (a ?? '').localeCompare(b ?? ''))
    .map(([role, members]) => ({
      title: titleOf(role),
      note: role === null ? 'No role is recorded for these accounts. They are not admins.' : undefined,
      data: members.sort((x, y) => nameOf(x).localeCompare(nameOf(y))),
    }));
}

async function succeeded(): Promise<void> {
  if (process.env.EXPO_OS === 'ios') {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
}

/** Keeps the server's own sentence: its refusals name mistakes no retry fixes. */
async function failed(title: string, error: unknown): Promise<void> {
  if (process.env.EXPO_OS === 'ios') {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
  Alert.alert(title, error instanceof ApiError ? error.message : 'Something went wrong.');
}
