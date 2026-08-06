import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, useRouter, type Href } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api';
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
  // A failed ask with nothing stored is "could not find out", not "not an admin".
  const unknownRole = role === null && me.isError;

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
        contentContainerStyle={{
          padding: Spacing.four,
          gap: Spacing.five,
          paddingBottom: Spacing.four + 72,
        }}>
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
        ) : me.isLoading ? (
          <ActivityIndicator style={{ marginTop: Spacing.seven }} />
        ) : unknownRole ? (
          <RoleUnknown
            error={me.error}
            onRetry={() => me.refetch()}
            retrying={me.isFetching}
          />
        ) : (
          <NotAnAdmin />
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

/** Only some of these are worth asking again; the rest are the answer. */
function roleFailure(error: unknown): { message: string; retry: boolean } {
  if (!(error instanceof ApiError)) {
    return { message: 'Something went wrong asking who you are.', retry: true };
  }
  if (error.kind === 'network') {
    return {
      message: 'Cannot reach your server. This is not a refusal — nothing was asked.',
      retry: true,
    };
  }
  if (error.kind === 'passkey-required') {
    return {
      message:
        'This account needs a passkey before the app can use it. Open your server in a browser and register one.',
      retry: false,
    };
  }
  if (error.kind === 'insufficient-scope') {
    return {
      message:
        'This app was not granted permission to read your account on this server. Sign out and connect it again.',
      retry: false,
    };
  }
  return { message: error.message, retry: true };
}

function RoleUnknown({
  error,
  onRetry,
  retrying,
}: {
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
}) {
  const c = useTheme();
  const { message, retry } = roleFailure(error);
  const offline = error instanceof ApiError && error.kind === 'network';

  return (
    <View
      style={{
        paddingTop: Spacing.seven,
        paddingHorizontal: Spacing.four,
        gap: Spacing.three,
        alignItems: 'center',
      }}>
      <Image
        source={offline ? 'sf:wifi.slash' : 'sf:exclamationmark.triangle'}
        tintColor={c.textTertiary}
        style={{ width: 40, height: 40 }}
      />
      <Text style={{ ...Type.title, color: c.text, textAlign: 'center' }}>
        Could not check your role
      </Text>
      <Text
        selectable
        style={{ ...Type.callout, color: c.textSecondary, textAlign: 'center' }}>
        {message} Until this server answers, the app cannot tell whether this
        account is an admin.
      </Text>
      {retry ? (
        <Pressable
          onPress={onRetry}
          disabled={retrying}
          accessibilityRole="button"
          style={{
            paddingHorizontal: Spacing.five,
            paddingVertical: Spacing.two,
            borderRadius: Radius.full,
            borderCurve: 'continuous',
            backgroundColor: c.backgroundSubtle,
          }}>
          <Text style={{ ...Type.subhead, fontWeight: '600', color: c.text }}>
            {retrying ? 'Checking…' : 'Try again'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
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
        These screens change the whole deployment — who has an account, which addresses receive
        mail, what is blocked — so this server only allows accounts with the admin role to open
        them. Ask an admin on this server if you need one.
      </Text>
    </View>
  );
}
