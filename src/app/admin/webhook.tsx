import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { AdminGate } from '@/components/admin-gate';
import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api';
import { key } from '@/lib/query';
import type { Me } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

/** `ConfigResponse`. No route ever returns the secret's value, only `hasSecret`. */
interface WebhookConfig {
  url: string;
  hasSecret: boolean;
}

/**
 * `TestResponse`. `ok` is the *delivery's* verdict, not the request's: a
 * refused, timed-out or 500-ing endpoint all come back inside a 200.
 */
interface TestResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** `buildWebhookPayload` truncates the body to this before sending it. */
const BODY_PREVIEW_CHARS = 280;

export default function WebhookScreen() {
  const c = useTheme();
  const router = useRouter();
  const server = useActiveServer();
  const queryClient = useQueryClient();

  // No route returns a secret, so a rotated one is only ever readable here.
  const [minted, setMinted] = useState<string | null>(null);

  // server.role is a sign-in snapshot and may be missing entirely, and this
  // route is deep-linkable, so it cannot lean on the hub having gated it.
  const me = useQuery({
    queryKey: key(server?.id ?? 'none', 'me'),
    enabled: !!server,
    queryFn: () => apiFetch<Me>(server!.id, '/api/user/me'),
  });
  const role = me.data?.role ?? server?.role ?? null;

  const config = useQuery({
    queryKey: key(server?.id ?? 'none', 'webhook'),
    enabled: !!server && role === 'admin',
    queryFn: () => apiFetch<WebhookConfig>(server!.id, '/api/webhook'),
  });

  const remove = useMutation({
    // A blank `url` deletes the whole row, secret included.
    mutationFn: () =>
      apiFetch<WebhookConfig>(server!.id, '/api/webhook', {
        method: 'PUT',
        body: { url: '' },
      }),
    onSuccess: async () => {
      await succeeded();
      setMinted(null);
      queryClient.invalidateQueries({ queryKey: key(server!.id, 'webhook') });
    },
    onError: async (error) => {
      await errored();
      Alert.alert('Could not remove the webhook', failureMessage(error));
    },
  });

  const setSecret = useMutation({
    // `url` omitted, not echoed back: a non-empty one is refused to this app and a
    // blank one deletes the row before `secret` is read.
    mutationFn: (secret: string | null) =>
      apiFetch<WebhookConfig>(server!.id, '/api/webhook', {
        method: 'PUT',
        body: { secret },
      }),
    onSuccess: async (_config, secret) => {
      await succeeded();
      setMinted(secret);
      queryClient.invalidateQueries({ queryKey: key(server!.id, 'webhook') });
    },
    onError: async (error) => {
      await errored();
      Alert.alert('Could not change the signing secret', failureMessage(error));
    },
  });

  const test = useMutation({
    mutationFn: () =>
      apiFetch<TestResult>(server!.id, '/api/webhook/test', { method: 'POST' }),
    onSuccess: async (result) => {
      if (result.ok) {
        await succeeded();
        Alert.alert(
          'Test delivered',
          result.status
            ? `Your endpoint answered ${result.status}.`
            : 'Your endpoint accepted it.',
        );
        return;
      }
      await errored();
      Alert.alert(
        'Test not delivered',
        result.status
          ? `Your endpoint answered ${result.status}. Anything outside 200–299 counts as a failed delivery, and real messages are dropped the same way.`
          : // No status means the request never completed: DNS, TLS, a refused
            // connection, or the server's ten-second timeout.
            (result.error ?? 'Your server could not reach that endpoint.'),
      );
    },
    onError: async (error) => {
      await errored();
      Alert.alert('Could not send a test', failureMessage(error));
    },
  });

  function confirmRemove(current: WebhookConfig) {
    // Clearing the URL drops the whole row, so the secret goes with it.
    const alsoSecret = current.hasSecret
      ? ' The signing secret is deleted along with it.'
      : '';

    Alert.alert(
      'Remove the webhook?',
      `Mail arriving at this deployment will stop being posted to ${current.url}.${alsoSecret} Only a browser can set a destination again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => remove.mutate() },
      ],
    );
  }

  function confirmRotate(current: WebhookConfig) {
    Alert.alert(
      current.hasSecret ? 'Replace the signing secret?' : 'Sign deliveries?',
      `${
        current.hasSecret
          ? `Messages posted to ${current.url} are signed with the new secret from the next one on, and your endpoint refuses them until it holds the same value.`
          : `Messages posted to ${current.url} start carrying an X-SaaSMail-Signature header your endpoint can check.`
      } The secret is shown on this screen once and no route ever returns it again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: current.hasSecret ? 'Replace' : 'Sign deliveries',
          onPress: () => setSecret.mutate(newSecret()),
        },
      ],
    );
  }

  function confirmClearSecret(current: WebhookConfig) {
    Alert.alert(
      'Stop signing deliveries?',
      `Messages posted to ${current.url} stop carrying a signature, so your endpoint cannot tell them from anything else that finds the URL. The destination itself stays.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear secret',
          style: 'destructive',
          onPress: () => setSecret.mutate(null),
        },
      ],
    );
  }

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

  const current = config.data ?? null;
  const destination = current?.url ? current.url : null;
  const busy = remove.isPending || test.isPending || setSecret.isPending;

  return (
    <>
      <Stack.Screen options={{ title: 'Webhook', headerLargeTitle: true }} />

      <Stack.Toolbar placement="bottom">
        {destination ? (
          <Stack.Toolbar.Button
            icon="paperplane"
            accessibilityLabel="Send a test delivery"
            disabled={test.isPending}
            onPress={() => test.mutate()}
          />
        ) : null}
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
            ? {
                padding: Spacing.four,
                gap: Spacing.five,
                // Clears the floating toolbar, which otherwise sits on the last row.
                paddingBottom: Spacing.four + 72,
              }
            : // The gate is a SwiftUI host, and a host given no height renders nothing.
              { flexGrow: 1 }
        }
        refreshControl={
          <RefreshControl
            refreshing={me.isRefetching || config.isRefetching}
            onRefresh={() => {
              // Refreshing only the config would leave someone just made an
              // admin still reading "Admins only".
              me.refetch();
              if (role === 'admin') config.refetch();
            }}
          />
        }>
        {role !== 'admin' ? (
          <AdminGate
            me={me}
            role={role}
            withheld="the webhook"
            reason="The webhook is one setting for the whole deployment, and it carries the contents of everyone’s mail, so this server lets only accounts with the admin role read or change it."
          />
        ) : (
          <>
            {config.isLoading ? <ActivityIndicator /> : null}
            {config.isError ? <Note>{failureMessage(config.error)}</Note> : null}

            {current ? (
              <Section title="Where mail is posted">
                <Card>
                  <Block label="Destination">
                    {destination ? (
                      <>
                        {/* Selectable for iOS's own Copy: no clipboard module here. */}
                        <Text selectable style={{ ...Type.body, color: c.text }}>
                          {destination}
                        </Text>
                        <Text style={{ ...Type.caption, color: c.textTertiary }}>
                          Every message arriving at this deployment is posted
                          there as it lands, carrying the sender, the subject and
                          the first {BODY_PREVIEW_CHARS} characters of the body.
                        </Text>
                        <Pressable
                          onPress={() => confirmRemove(current)}
                          accessibilityRole="button"
                          // A second clear answers 200 against an already-empty
                          // row, which reads as a fresh success.
                          disabled={remove.isPending}
                          style={({ pressed }) => ({
                            paddingTop: Spacing.one,
                            opacity: pressed ? 0.6 : 1,
                          })}>
                          <Text
                            style={{
                              ...Type.subhead,
                              fontWeight: '600',
                              color: c.danger,
                            }}>
                            Remove webhook
                          </Text>
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <Text style={{ ...Type.body, color: c.textSecondary }}>
                          Nothing configured
                        </Text>
                        <Text style={{ ...Type.caption, color: c.textTertiary }}>
                          Inbound mail is not being posted anywhere.
                        </Text>
                      </>
                    )}
                  </Block>

                  {/* The server stores a secret only as part of a destination row. */}
                  {destination ? (
                    <>
                      <Divider />
                      <Block label="Signing secret">
                        <Text style={{ ...Type.body, color: c.text }}>
                          {current.hasSecret ? 'Set' : 'Not set'}
                        </Text>
                        <Text style={{ ...Type.caption, color: c.textTertiary }}>
                          {current.hasSecret
                            ? 'Deliveries carry an X-SaaSMail-Signature header your endpoint can check before trusting them.'
                            : 'Deliveries are unsigned, so your endpoint cannot tell them from anything else that finds the URL.'}
                        </Text>

                        {minted ? (
                          <>
                            {/* Selectable for iOS's own Copy: no clipboard module here. */}
                            <Text
                              selectable
                              style={{ ...Type.footnote, color: c.text }}>
                              {minted}
                            </Text>
                            <Text style={{ ...Type.caption, color: c.warning }}>
                              Shown once. Leaving this screen loses it, and the only
                              way back is another new secret.
                            </Text>
                          </>
                        ) : null}

                        <Pressable
                          onPress={() => confirmRotate(current)}
                          accessibilityRole="button"
                          disabled={setSecret.isPending}
                          style={({ pressed }) => ({
                            paddingTop: Spacing.one,
                            opacity: pressed ? 0.6 : 1,
                          })}>
                          <Text
                            style={{
                              ...Type.subhead,
                              fontWeight: '600',
                              color: c.primary,
                            }}>
                            {current.hasSecret
                              ? 'Replace signing secret'
                              : 'Add a signing secret'}
                          </Text>
                        </Pressable>

                        {current.hasSecret ? (
                          <Pressable
                            onPress={() => confirmClearSecret(current)}
                            accessibilityRole="button"
                            disabled={setSecret.isPending}
                            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                            <Text
                              style={{
                                ...Type.subhead,
                                fontWeight: '600',
                                color: c.danger,
                              }}>
                              Clear signing secret
                            </Text>
                          </Pressable>
                        ) : null}
                      </Block>
                    </>
                  ) : null}
                </Card>

                <Note>
                  A destination is set in your server’s web dashboard, in a
                  browser. Apps may clear one but never set one: a destination is
                  a standing channel for every future inbound message, not a
                  one-off, so pointing it somewhere is a decision the server
                  takes only from a browser session.
                </Note>

                <Note>
                  The signing secret changes here: rotating one escalates nothing,
                  so it is the half an app may send. The server stores it alongside
                  the destination it signs for, so there can be no secret until
                  there is somewhere to post, and removing the webhook deletes both.
                </Note>
              </Section>
            ) : null}

            {/* Survives a failed config read: a browser is where the fix is. */}
            {config.isLoading ? null : (
              <Section title="Your server">
                <Card>
                  <Pressable
                    onPress={() => openBrowserAsync(server.origin)}
                    accessibilityRole="link"
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: Spacing.three,
                      padding: Spacing.three,
                      backgroundColor: pressed ? c.backgroundSelected : 'transparent',
                    })}>
                    <Image
                      source="sf:globe"
                      tintColor={c.primary}
                      style={{ width: 22, height: 22 }}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ ...Type.body, color: c.text }}>
                        Open {server.brandName} in a browser
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={{ ...Type.footnote, color: c.textSecondary }}>
                        {server.origin}
                      </Text>
                    </View>
                    <Image
                      source="sf:arrow.up.forward"
                      tintColor={c.textTertiary}
                      style={{ width: 12, height: 12 }}
                    />
                  </Pressable>
                </Card>
                {/* The origin, not the settings path: it has moved between API
                    versions, and this app talks to all of them. */}
                <Note>
                  {!current
                    ? 'The destination is set there.'
                    : destination
                      ? 'Sign in there to change the destination.'
                      : 'Sign in there to point this deployment’s inbound mail at a URL.'}
                </Note>
              </Section>
            )}

            {busy ? <ActivityIndicator /> : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

/**
 * Code before kind: `parseError` collapses both OAuth refusals into
 * `insufficient-scope`, but only `OAUTH_INSUFFICIENT_SCOPE` is fixed by
 * consenting again.
 */
function failureMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong.';
  if (error.code === 'OAUTH_SCOPE_DENIED') return error.message;
  if (error.kind === 'insufficient-scope') {
    return 'This app was not granted admin permission on this server. Sign out and connect it again.';
  }
  if (error.kind === 'forbidden') return 'Your account is not an admin on this server.';
  if (error.kind === 'network') return 'Cannot reach your server.';
  return error.message;
}

/** 32 bytes of hex: the route stores whatever string it is sent, weak ones included. */
function newSecret(): string {
  return Array.from(Crypto.getRandomBytes(32), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function succeeded(): Promise<void> {
  if (process.env.EXPO_OS === 'ios') {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
}

async function errored(): Promise<void> {
  if (process.env.EXPO_OS === 'ios') {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
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

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ padding: Spacing.three, gap: Spacing.two }}>
      <Text style={{ ...Type.footnote, fontWeight: '600', color: c.textSecondary }}>
        {label}
      </Text>
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
