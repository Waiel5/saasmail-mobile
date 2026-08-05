import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { InboxRowItem, RowSeparator } from '@/components/inbox-row';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiFetch } from '@/lib/api';
import { key } from '@/lib/query';
import type { GroupedResponse } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

export default function SearchScreen() {
  const c = useTheme();
  const server = useActiveServer();
  const [q, setQ] = useState('');

  const query = useQuery({
    queryKey: key(server?.id ?? 'none', 'search', q),
    // The server filters by name and email; searching an empty string would
    // just re-fetch the inbox, so it stays idle until there is a term.
    enabled: !!server && q.trim().length > 1,
    queryFn: () =>
      apiFetch<GroupedResponse>(
        server!.id,
        `/api/people/grouped?limit=50&q=${encodeURIComponent(q.trim())}`,
      ),
  });

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Search',
          headerLargeTitle: true,
          headerSearchBarOptions: {
            placeholder: 'People and addresses',
            onChangeText: (e: { nativeEvent: { text: string } }) => setQ(e.nativeEvent.text),
            hideWhenScrolling: false,
          },
        }}
      />
      <FlatList
        data={query.data?.data ?? []}
        keyExtractor={(row) => `${row.type}:${row.id}`}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        ItemSeparatorComponent={RowSeparator}
        renderItem={({ item }) => <InboxRowItem row={item} serverId={server!.id} />}
        ListEmptyComponent={
          <View style={{ paddingTop: Spacing.seven, paddingHorizontal: Spacing.six }}>
            <Text style={{ ...Type.callout, color: c.textSecondary, textAlign: 'center' }}>
              {q.trim().length > 1 ? 'Nobody matches that.' : 'Search for a person or address.'}
            </Text>
          </View>
        }
      />
    </>
  );
}
