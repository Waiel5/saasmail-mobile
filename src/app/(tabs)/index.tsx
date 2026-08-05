import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Redirect, Stack, useRouter } from 'expo-router';
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

  // No server yet — the app has nothing to show until one is added, so this is
  // the first run rather than an empty inbox.
  if (!server) return <Redirect href="/add-server" />;

  const query = useQuery({
    queryKey: key(server.id, 'people', 'grouped', unreadOnly ? 'unread' : 'all'),
    queryFn: () =>
      apiFetch<GroupedResponse>(
        server.id,
        `/api/people/grouped?limit=50${unreadOnly ? '&unread=1' : ''}`,
      ),
  });

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
