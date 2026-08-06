import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AdminGate } from '@/components/admin-gate';
import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiFetch } from '@/lib/api';
import { key } from '@/lib/query';
import type { Me } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

interface Area {
  href: Href;
  /** `expo-image` renders SF Symbols only from an `sf:`-prefixed source. */
  icon: string;
  label: string;
  detail: string;
}

const AREAS: { title: string; items: Area[] }[] = [
  {
    title: 'People',
    items: [
      {
        href: '/admin/users',
        icon: 'sf:person.2',
        label: 'People',
        detail: 'Everyone with an account on this server.',
      },
      {
        href: '/admin/invites',
        icon: 'sf:person.badge.plus',
        label: 'Invites',
        detail: 'Invitation links, and the ones still unused.',
      },
    ],
  },
  {
    title: 'Mail',
    items: [
      {
        href: '/admin/inboxes',
        icon: 'sf:tray.2',
        label: 'Inboxes',
        detail: 'Addresses that receive mail, and who may read them.',
      },
      {
        href: '/admin/domains',
        icon: 'sf:at',
        label: 'Domains',
        detail: 'Whether DNS lets mail reach this deployment.',
      },
      {
        href: '/admin/blocklist',
        icon: 'sf:hand.raised',
        label: 'Blocklist',
        detail: 'Senders whose incoming mail is hidden.',
      },
      {
        href: '/admin/suppressions',
        icon: 'sf:nosign',
        label: 'Suppressions',
        detail: 'Addresses this server will not send to.',
      },
      {
        href: '/admin/webhook',
        icon: 'sf:link',
        label: 'Webhook',
        detail: 'Where inbound mail is posted as it arrives.',
      },
    ],
  },
];

export default function AdminScreen() {
  const router = useRouter();
  const server = useActiveServer();

  // server.role is a sign-in snapshot and may be missing entirely, so an admin
  // would read as "not an admin" without asking again.
  const me = useQuery({
    queryKey: key(server?.id ?? 'none', 'me'),
    enabled: !!server,
    queryFn: () => apiFetch<Me>(server!.id, '/api/user/me'),
  });
  const role = me.data?.role ?? server?.role ?? null;

  return (
    <>
      <Stack.Screen options={{ title: 'Admin', headerLargeTitle: true }} />

      <Stack.Toolbar placement="bottom">
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

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={
          role === 'admin'
            ? { padding: Spacing.four, gap: Spacing.five, paddingBottom: Spacing.four + 72 }
            : // The gate is a SwiftUI host, and a host given no height renders nothing.
              { flexGrow: 1 }
        }>
        {role === 'admin' ? (
          AREAS.map((group) => (
            <Group key={group.title} title={group.title}>
              {group.items.map((area, i) => (
                <View key={area.label}>
                  {i > 0 ? <Divider /> : null}
                  <AreaRow area={area} onPress={() => router.push(area.href)} />
                </View>
              ))}
            </Group>
          ))
        ) : (
          <AdminGate
            me={me}
            role={role}
            reason="These screens change the whole deployment — who has an account, which addresses receive mail, what is blocked — so this server only allows accounts with the admin role to open them. Ask an admin on this server if you need one."
          />
        )}
      </ScrollView>
    </>
  );
}

function AreaRow({ area, onPress }: { area: Area; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.three,
        padding: Spacing.three,
        backgroundColor: pressed ? c.backgroundSelected : 'transparent',
      })}>
      <Image source={area.icon} tintColor={c.primary} style={{ width: 22, height: 22 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...Type.body, color: c.text }}>{area.label}</Text>
        <Text style={{ ...Type.footnote, color: c.textSecondary }}>{area.detail}</Text>
      </View>
      <Image
        source="sf:chevron.right"
        tintColor={c.textTertiary}
        style={{ width: 12, height: 12 }}
      />
    </Pressable>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
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
      <View
        style={{
          backgroundColor: c.surface,
          borderRadius: Radius.xl,
          borderCurve: 'continuous',
          overflow: 'hidden',
        }}>
        {children}
      </View>
    </View>
  );
}

function Divider() {
  const c = useTheme();
  return <View style={{ height: HAIRLINE, backgroundColor: c.border }} />;
}
