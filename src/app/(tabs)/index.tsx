import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { InboxRowItem, RowSeparator } from '@/components/inbox-row';
import { ServerSwitcherTitle } from '@/components/server-switcher';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api';
import { key } from '@/lib/query';
import type { GroupedResponse } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

export default function InboxScreen() {
  const c = useTheme();
  const router = useRouter();
  const server = useActiveServer();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const query = useQuery({
    queryKey: key(server?.id ?? 'none', 'people', 'grouped', unreadOnly ? 'unread' : 'all'),
    enabled: !!server,
    queryFn: () =>
      apiFetch<GroupedResponse>(
        server!.id,
        `/api/people/grouped?limit=50${unreadOnly ? '&unread=1' : ''}`,
      ),
  });

  // First run. This is the onboarding rather than an error: the app cannot
  // show mail until it knows which deployment to ask.
  if (!server) return <FirstRun />;

  const rows = query.data?.data ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          // The switcher replaces the title: on an app that is defined by
          // talking to several deployments, which one you are looking at is
          // the most important thing on screen.
          headerTitle: () => <ServerSwitcherTitle />,
          headerLargeTitle: false,
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/compose')}
              hitSlop={12}
              accessibilityLabel="New message">
              <Image source="sf:square.and.pencil" tintColor={c.primary} style={{ width: 22, height: 22 }} />
            </Pressable>
          ),
        }}
      />

      <FlatList
        data={rows}
        keyExtractor={(row) => `${row.type}:${row.id}`}
        contentInsetAdjustmentBehavior="automatic"
        ItemSeparatorComponent={RowSeparator}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />
        }
        renderItem={({ item }) => <InboxRowItem row={item} serverId={server.id} />}
        ListHeaderComponent={
          <FilterBar unreadOnly={unreadOnly} onToggle={() => setUnreadOnly((v) => !v)} />
        }
        ListEmptyComponent={
          query.isLoading ? (
            <View style={{ paddingTop: Spacing.seven, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : (
            <EmptyState error={query.error} unreadOnly={unreadOnly} />
          )
        }
      />
    </>
  );
}

/**
 * Unread is the only filter offered, because `is_read` is the only per-message
 * state this API stores. Offering more would mean inventing filters with
 * nothing behind them.
 */
function FilterBar({ unreadOnly, onToggle }: { unreadOnly: boolean; onToggle: () => void }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: Spacing.four, paddingVertical: Spacing.two }}>
      <Pressable
        onPress={onToggle}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.one + 2,
          paddingHorizontal: Spacing.three,
          paddingVertical: Spacing.one + 2,
          borderRadius: Radius.full,
          backgroundColor: unreadOnly ? c.unread : c.backgroundSubtle,
        }}>
        <Text
          style={{
            ...Type.footnote,
            fontWeight: '600',
            color: unreadOnly ? '#FFFFFF' : c.textSecondary,
          }}>
          Unread
        </Text>
      </Pressable>
    </View>
  );
}

function EmptyState({ error, unreadOnly }: { error: unknown; unreadOnly: boolean }) {
  const c = useTheme();

  // A member with no inbox assignments gets 200 and an empty array — identical
  // to a quiet mailbox. Saying "no mail" there would send them looking for a
  // problem in the wrong place, so the two cases read differently.
  const message =
    error instanceof ApiError
      ? error.kind === 'passkey-required'
        ? 'This account needs a passkey. Open your saasmail server in a browser and register one, then pull to refresh.'
        : error.message
      : unreadOnly
        ? 'Nothing unread.'
        : 'No messages yet. When someone emails one of your inboxes, they appear here.';

  return (
    <View style={{ paddingTop: Spacing.seven, paddingHorizontal: Spacing.six, gap: Spacing.three }}>
      <Image
        source={error ? 'sf:exclamationmark.triangle' : 'sf:tray'}
        tintColor={c.textTertiary}
        style={{ width: 34, height: 34, alignSelf: 'center' }}
      />
      <Text selectable style={{ ...Type.callout, color: c.textSecondary, textAlign: 'center' }}>
        {message}
      </Text>
    </View>
  );
}

/**
 * What a brand-new install sees.
 *
 * Deliberately not a redirect into the add-server sheet: a sheet presented over
 * an empty stack has nothing behind it and reads as a blank screen. This is a
 * real first screen, and it explains *why* an address is needed — self-hosting
 * is the part of this product a newcomer will not assume.
 */
function FirstRun() {
  const c = useTheme();
  const router = useRouter();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.four,
        paddingHorizontal: Spacing.six,
      }}>
      <Image source="sf:tray.and.arrow.down" tintColor={c.primary} style={{ width: 52, height: 52 }} />
      <Text style={{ ...Type.title, color: c.text, textAlign: 'center' }}>Connect your mail</Text>
      <Text style={{ ...Type.callout, color: c.textSecondary, textAlign: 'center' }}>
        saasmail runs on your own Cloudflare account, so there is no account to sign up for. Point
        the app at your deployment and sign in there.
      </Text>
      <Pressable
        onPress={() => router.push('/add-server')}
        style={({ pressed }) => ({
          paddingHorizontal: Spacing.six,
          paddingVertical: Spacing.three,
          borderRadius: 999,
          backgroundColor: c.primary,
          opacity: pressed ? 0.85 : 1,
        })}>
        <Text style={{ ...Type.headline, color: c.onPrimary }}>Add a server</Text>
      </Pressable>
    </View>
  );
}
