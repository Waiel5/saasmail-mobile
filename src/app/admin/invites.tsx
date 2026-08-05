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
  ScrollView,
  Share,
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
import { useActiveServer } from '@/lib/use-servers';

/**
 * `InviteSchema` from the worker's admin router. Timestamps are epoch
 * **seconds**; read as milliseconds every invitation expires in 1970.
 */
interface Invite {
  id: string;
  /** The credential itself: whoever holds it can create an account. Never log it. */
  token: string;
  role: string;
  email: string | null;
  expiresAt: number;
  usedBy: string | null;
  usedAt: number | null;
  createdBy: string;
  createdAt: number;
}

/** Seven days is the server's ceiling for a bearer caller; 14 would always fail. */
const EXPIRY_CHOICES = [1, 3, 7] as const;
type ExpiryDays = (typeof EXPIRY_CHOICES)[number];

export default function InvitesScreen() {
  const c = useTheme();
  const server = useActiveServer();
  const queryClient = useQueryClient();

  const [address, setAddress] = useState('');
  const [days, setDays] = useState<ExpiryDays>(7);
  // Kept in state because the list route is usually refused and a token is
  // never returned a second time.
  const [mine, setMine] = useState<Invite[]>([]);

  const listed = useQuery({
    queryKey: key(server?.id ?? 'none', 'admin', 'invites'),
    enabled: !!server,
    queryFn: () => apiFetch<Invite[]>(server!.id, '/api/admin/invites'),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<Invite>(server!.id, '/api/admin/invites', {
        method: 'POST',
        // These three fields and no others: the bearer-token guard rejects the
        // whole request over an unclassified key rather than ignoring it.
        body: {
          role: 'member',
          email: address.trim(),
          expiresInDays: days,
        },
      }),
    onSuccess: async (invite) => {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setMine((current) => [invite, ...current]);
      setAddress('');
      queryClient.invalidateQueries({
        queryKey: key(server!.id, 'admin', 'invites'),
      });
      share(invite);
    },
    onError: async (error) => {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      Alert.alert(
        'Could not invite',
        error instanceof ApiError
          ? error.message
          : 'Something went wrong creating this invitation.',
      );
    },
  });

  const revoke = useMutation({
    mutationFn: (invite: Invite) =>
      // The path takes the id. The token answers 404 and leaves the credential
      // working.
      apiFetch<{ success: true }>(
        server!.id,
        `/api/admin/invites/${encodeURIComponent(invite.id)}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_result, invite) => {
      setMine((current) => current.filter((row) => row.id !== invite.id));
      queryClient.invalidateQueries({
        queryKey: key(server!.id, 'admin', 'invites'),
      });
    },
    onError: (error) => {
      Alert.alert(
        'Could not revoke',
        error instanceof ApiError
          ? error.message
          : 'Something went wrong revoking this invitation.',
      );
    },
  });

  async function share(invite: Invite) {
    const url = `${server!.origin}/invite/${invite.token}`;
    try {
      await Share.share(
        // Android's Share ignores `url` and would present an empty sheet, so
        // there the link has to travel as `message`.
        process.env.EXPO_OS === 'ios' ? { url } : { message: url },
        { subject: `Join ${server!.brandName}` },
      );
    } catch {
      // A sheet that failed to present needs no alert; the row offers it again.
    }
  }

  function confirmRevoke(invite: Invite) {
    Alert.alert(
      'Revoke this invitation?',
      `${invite.email ?? 'The link'} will stop working. Anyone who has already signed up with it keeps their account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => revoke.mutate(invite),
        },
      ],
    );
  }

  function openActions(invite: Invite) {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: invite.email ?? 'Invitation',
        options: ['Share link', 'Revoke invitation', 'Cancel'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) share(invite);
        if (index === 1) confirmRevoke(invite);
      },
    );
  }

  function pickExpiry() {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Invitation expires in',
        options: [...EXPIRY_CHOICES.map(expiryLabel), 'Cancel'],
        cancelButtonIndex: EXPIRY_CHOICES.length,
      },
      (index) => {
        if (index < EXPIRY_CHOICES.length) setDays(EXPIRY_CHOICES[index]);
      },
    );
  }

  const refusal = explainListFailure(listed.error);
  const trimmed = address.trim();
  const problem = refusal?.blocking
    ? refusal.note
    : !trimmed
      ? 'Enter the address to invite.'
      : !isEmail(trimmed)
        ? 'That does not look like an email address.'
        : null;

  // Without the union a fresh invitation vanishes between the mutation and the
  // refetch, and its token is the only copy in existence.
  const rows = [
    ...mine,
    ...(listed.data ?? []).filter((row) => !mine.some((own) => own.id === row.id)),
  ].filter(isUsable);

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
      <Stack.Screen options={{ title: 'Invites', headerLargeTitle: true }} />

      <Stack.Toolbar placement="bottom">
        {mine[0] ? (
          <Stack.Toolbar.Button
            icon="square.and.arrow.up"
            accessibilityLabel="Share the newest invitation link"
            onPress={() => share(mine[0])}
          />
        ) : null}
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button
          icon="person.badge.plus"
          accessibilityLabel="Create invitation"
          accessibilityHint={problem ?? undefined}
          separateBackground
          disabled={!!problem || create.isPending}
          onPress={() => create.mutate()}
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
        }}>
        {refusal?.blocking ? null : (
          <Section title="Invite someone">
            <Card>
              <Field label="To">
                <TextInput
                  value={address}
                  onChangeText={setAddress}
                  placeholder="name@example.com"
                  placeholderTextColor={c.textTertiary}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  onSubmitEditing={() => {
                    if (!problem) create.mutate();
                  }}
                  style={{ ...Type.body, color: c.text, flex: 1, padding: 0 }}
                />
              </Field>
              <Divider />
              <Field label="Expires" onPress={pickExpiry}>
                <Text style={{ ...Type.body, color: c.text, flex: 1 }}>
                  {expiryLabel(days)}
                </Text>
              </Field>
            </Card>

            {trimmed && problem ? <Note>{problem}</Note> : null}

            <Note>
              Every invitation from this app is a member invitation, redeemable
              only by the address you name and only for as long as you set above.
              Admin invitations are made in a browser.
            </Note>

            {create.isPending ? <ActivityIndicator /> : null}
          </Section>
        )}

        <Section title="Pending">
          {rows.length > 0 ? (
            <Card>
              {rows.map((invite, i) => (
                <View key={invite.id}>
                  {i > 0 ? <Divider /> : null}
                  <InviteRow
                    invite={invite}
                    // Only tokens minted here are printed: a screen of listed
                    // tokens is a screen of live credentials.
                    link={
                      mine.some((own) => own.id === invite.id)
                        ? `${server.origin}/invite/${invite.token}`
                        : null
                    }
                    onPress={() => openActions(invite)}
                  />
                </View>
              ))}
            </Card>
          ) : null}

          {listed.isLoading ? <ActivityIndicator /> : null}

          <Note>
            {refusal
              ? refusal.note
              : rows.length === 0
                ? 'No invitations are waiting to be accepted.'
                : 'Tap an invitation to share its link again or to revoke it. Accepted and expired invitations are not listed.'}
          </Note>
        </Section>
      </ScrollView>
    </>
  );
}

function isUsable(invite: Invite): boolean {
  return !invite.usedBy && invite.expiresAt * 1000 > Date.now();
}

function expiryLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * Three different 403s reach this screen and only `OAUTH_SCOPE_DENIED` leaves
 * the form usable, so they are told apart by code rather than by kind.
 */
function explainListFailure(
  error: unknown,
): { note: string; blocking: boolean } | null {
  if (!(error instanceof ApiError)) return null;

  if (error.code === 'OAUTH_SCOPE_DENIED') {
    return {
      note: 'This server does not let apps read the invitation list — a live invitation is as good as an account, so only a browser can enumerate them. Invitations you create here stay listed until you leave this screen.',
      blocking: false,
    };
  }
  if (error.code === 'OAUTH_INSUFFICIENT_SCOPE') {
    return {
      note: 'This app was not granted admin permission on this server. Sign out and connect it again.',
      blocking: true,
    };
  }
  if (error.kind === 'forbidden') {
    return { note: 'Your account is not an admin on this server.', blocking: true };
  }
  if (error.kind === 'network') {
    return {
      note: 'Cannot reach your server, so pending invitations are not shown.',
      blocking: false,
    };
  }
  return { note: error.message, blocking: false };
}

function InviteRow({
  invite,
  link,
  onPress,
}: {
  invite: Invite;
  link: string | null;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Invitation for ${invite.email ?? 'anyone with the link'}`}
      style={({ pressed }) => ({
        padding: Spacing.three,
        gap: 2,
        backgroundColor: pressed ? c.backgroundSelected : 'transparent',
      })}>
      <Text numberOfLines={1} style={{ ...Type.body, color: c.text }}>
        {invite.email ?? 'Anyone with the link'}
      </Text>
      <Text style={{ ...Type.footnote, color: c.textSecondary }}>
        {invite.role === 'admin' ? 'Admin' : 'Member'} · Expires{' '}
        {formatMessageTime(invite.expiresAt)}
      </Text>
      {/* Selectable for iOS's own Copy: this app ships no clipboard module. */}
      {link ? (
        <Text
          selectable
          style={{ ...Type.footnote, color: c.textTertiary, paddingTop: 2 }}>
          {link}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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
      <Text style={{ ...Type.body, color: c.textSecondary, width: 72 }}>
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
