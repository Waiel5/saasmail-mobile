import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiFetch } from '@/lib/api';
import { ServerError, probeServer, signInToServer } from '@/lib/auth';
import { upsertServer, writeCredentials } from '@/lib/servers';
import type { Me } from '@/lib/types';

export default function AddServerScreen() {
  const c = useTheme();
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'authorizing'>('idle');
  const [error, setError] = useState<string | null>(null);

  const busy = status !== 'idle';

  async function connect() {
    setError(null);
    setStatus('checking');
    try {
      const probe = await probeServer(address);

      setStatus('authorizing');
      const { record, credentials } = await signInToServer(probe, { wantsAdmin: true });

      // Credentials before the record: a record without them is a server the
      // UI lists and cannot use. The other order is invisible and harmless.
      await writeCredentials(record.id, credentials);
      upsertServer(record);

      // After the upsert: `apiFetch` looks the server up by id.
      try {
        const me = await apiFetch<Me>(record.id, '/api/user/me');
        upsertServer({ ...record, userId: me.id, userEmail: me.email, role: me.role ?? undefined });
      } catch {
        // Not fatal: the account works, admin screens stay hidden until a
        // later fetch fills in the role.
      }

      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.back();
    } catch (err) {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      setError(err instanceof ServerError ? err.message : 'Something went wrong');
    } finally {
      setStatus('idle');
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: Spacing.four, gap: Spacing.five }}>
      <View style={{ gap: Spacing.two }}>
        <Text style={{ ...Type.title, color: c.text }}>Connect a server</Text>
        <Text style={{ ...Type.subhead, color: c.textSecondary }}>
          saasmail is self-hosted, so there is no central account. Enter the address of your
          deployment and sign in there.
        </Text>
      </View>

      <View style={{ gap: Spacing.two }}>
        <Text
          style={{
            ...Type.caption,
            fontWeight: '600',
            color: c.textTertiary,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}>
          Server address
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.two,
            paddingHorizontal: Spacing.three,
            backgroundColor: c.backgroundSubtle,
            borderRadius: Radius.xl,
            borderCurve: 'continuous',
          }}>
          <Image source="sf:globe" tintColor={c.textTertiary} style={{ width: 17, height: 17 }} />
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="mail.yourcompany.com"
            placeholderTextColor={c.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            inputMode="url"
            editable={!busy}
            returnKeyType="go"
            onSubmitEditing={connect}
            style={{ ...Type.body, flex: 1, color: c.text, paddingVertical: Spacing.three }}
          />
        </View>

        {error ? (
          <Text selectable style={{ ...Type.footnote, color: c.danger }}>
            {error}
          </Text>
        ) : (
          <Text style={{ ...Type.footnote, color: c.textTertiary }}>
            You will sign in on your server&apos;s own page, so your passkey works as usual.
          </Text>
        )}
      </View>

      <Pressable
        onPress={connect}
        disabled={busy || address.trim().length === 0}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: Spacing.two,
          paddingVertical: Spacing.three + 2,
          borderRadius: Radius.full,
          backgroundColor: c.primary,
          opacity: busy || address.trim().length === 0 ? 0.5 : pressed ? 0.85 : 1,
        })}>
        {busy ? <ActivityIndicator color={c.onPrimary} /> : null}
        <Text style={{ ...Type.headline, color: c.onPrimary }}>
          {status === 'checking'
            ? 'Checking server…'
            : status === 'authorizing'
              ? 'Waiting for sign-in…'
              : 'Continue'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
