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
 * `InviteSchema` from the worker's admin router.
 *
 * The timestamps are epoch **seconds** — the columns hold dates and the route
 * divides by 1000 on the way out. Read as milliseconds, every invitation
 * expires in January 1970 and this screen shows none of them.
 */
interface Invite {
  id: string;
  /**
   * The credential itself: whoever holds this can create an account on the
   * deployment. It is never logged, and leaves the app only through a share
   * sheet the operator opened.
   */
  token: string;
  role: string;
  email: string | null;
  expiresAt: number;
  usedBy: string | null;
  usedAt: number | null;
  createdBy: string;
  createdAt: number;
}

/**
 * Seven days is the server's ceiling for a bearer caller, not a house
 * preference. Offering 14 would put an option in the picker that always fails.
 */
const EXPIRY_CHOICES = [1, 3, 7] as const;
type ExpiryDays = (typeof EXPIRY_CHOICES)[number];

/**
 * Inviting somebody to this deployment.
 *
 * The form is an address and an expiry and nothing else, because that is the
 * only shape of invitation an OAuth client may mint: the server clamps the body
 * to `role: "member"`, an address the invitation is pinned to, and at most seven
 * days. It refuses the whole request rather than dropping the field it dislikes,
 * so a role picker here would be a control whose every non-default value fails.
 * Admin invitations are made in a browser, which the note under the form says
 * out loud rather than leaving the absence to be discovered.
 *
 * Reading the invitation list is closed to this app under the same policy — a
 * live token is as good as an account, so only a browser session may enumerate
 * them. That refusal is a normal state for this screen rather than an error, so
 * it renders as a sentence beside a working form, and invitations created here
 * stay listed from memory.
 */
export default function InvitesScreen() {
  const c = useTheme();
  const server = useActiveServer();
  const queryClient = useQueryClient();

  const [address, setAddress] = useState('');
  const [days, setDays] = useState<ExpiryDays>(7);
  /**
   * Invitations created here, newest first. Held in state because the list
   * route is usually refused — and because the token is both the only part that
   * matters and the only part that cannot be fetched again.
   */
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
        // These three fields and no others: the bearer-token guard rejects a
        // body carrying any field it has not classified, so an extra key fails
        // the request rather than being quietly ignored.
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
      // Straight into the share sheet. An invitation nobody receives is not an
      // invitation, and this is the one moment its link is certainly in hand.
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
      // The path takes the invitation's id. Passing the token instead answers
      // 404 and leaves a working credential behind, which is the worst possible
      // outcome for an action labelled "revoke".
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
        // iOS treats `url` as a link activity item, so Messages inserts a real
        // link and the sheet's own Copy copies the address — which is where
        // copying lives, this app having no clipboard module of its own.
        // Android's Share ignores `url` outright and would present an empty
        // sheet, so there the link has to travel as the message body.
        process.env.EXPO_OS === 'ios' ? { url } : { message: url },
        { subject: `Join ${server!.brandName}` },
      );
    } catch {
      // A sheet that failed to present is not worth an alert: the link is still
      // on screen and the row offers the same action again.
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

  // Invitations made here first, then whatever the server was willing to list,
  // minus the overlap. Without the union a fresh invitation vanishes between
  // the mutation and the refetch — and its token is the only copy in existence.
  const rows = [
    ...mine,
    ...(listed.data ?? []).filter((row) => !mine.some((own) => own.id === row.id)),
  ].filter(isUsable);

  // Reachable by signing out of the last account while this screen is open.
  // Everything below builds a link out of `server.origin`.
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

      {/*
        The inbox's bar with this screen's nouns in it: contextual action left,
        the thing that creates something right and detached. The share button
        appears only once there is a link to share, exactly as the thread
        screen's reply button appears only once there is something to reply to.
      */}
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
        {/*
          No form at all when the account or the app lacks the admin surface:
          creating would fail exactly as listing did, and a form that cannot
          submit is a worse answer than the sentence explaining why.
        */}
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
                    // The link is printed only for invitations created here.
                    // Anything the server listed is already sendable from the
                    // share sheet, and a screen of live tokens is a screen of
                    // live credentials.
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

/** Still redeemable: nobody has used it and it has not run out. */
function isUsable(invite: Invite): boolean {
  return !invite.usedBy && invite.expiresAt * 1000 > Date.now();
}

function expiryLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * Why the list is missing, and whether creating still works.
 *
 * Three different 403s reach this screen and only one of them leaves the form
 * usable, so they are told apart by the server's own code rather than collapsed
 * into "forbidden". Reporting the wrong one sends an operator off to re-consent
 * an app that is working correctly, or to file a bug against a deliberate
 * policy.
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
      {/*
        Selectable so iOS's own selection menu offers Copy on a long press. It
        is the second of the two copy paths this app can offer without a
        clipboard dependency; the first is the share sheet's Copy activity.
      */}
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

/**
 * One form row: a fixed-width label, then the control.
 *
 * The label column is a fixed width rather than intrinsic so the values line up
 * down one edge; with intrinsic widths each row starts its value at a different
 * x and two rows read as two unrelated things.
 */
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
