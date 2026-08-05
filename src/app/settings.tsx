import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { forgetServer } from '@/lib/query';
import { removeServer, setActiveServerId, type ServerRecord } from '@/lib/servers';
import { useActiveServerId, useServers } from '@/lib/use-servers';

export default function SettingsScreen() {
  const c = useTheme();
  const router = useRouter();
  const servers = useServers();
  const activeId = useActiveServerId();

  async function signOut(server: ServerRecord) {
    // Hard delete of local credentials, so it is worth one confirmation — but
    // it destroys nothing on the server, which the copy says plainly rather
    // than implying data loss.
    Alert.alert(
      `Sign out of ${server.brandName}?`,
      'This removes the account from this device. Nothing on the server changes.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await forgetServer(server.id);
            await removeServer(server.id);
          },
        },
      ],
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Settings', headerLargeTitle: true }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: Spacing.four, gap: Spacing.five }}>
        <Section title="Servers">
          <View
            style={{
              backgroundColor: c.surface,
              borderRadius: Radius.xl,
              borderCurve: 'continuous',
              overflow: 'hidden',
            }}>
            {servers.map((server, i) => (
              <View key={server.id}>
                {i > 0 ? <View style={{ height: HAIRLINE, backgroundColor: c.border }} /> : null}
                <Pressable
                  onPress={() => setActiveServerId(server.id)}
                  onLongPress={() => signOut(server)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: Spacing.three,
                    padding: Spacing.three,
                    backgroundColor: pressed ? c.backgroundSelected : 'transparent',
                  })}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ ...Type.body, color: c.text }}>{server.brandName}</Text>
                    <Text style={{ ...Type.footnote, color: c.textSecondary }}>
                      {server.userEmail ?? new URL(server.origin).host}
                      {server.role === 'admin' ? ' · Admin' : ''}
                    </Text>
                  </View>
                  {server.id === activeId ? (
                    <Image
                      source="sf:checkmark"
                      tintColor={c.primary}
                      style={{ width: 17, height: 17 }}
                    />
                  ) : null}
                </Pressable>
              </View>
            ))}

            {servers.length > 0 ? (
              <View style={{ height: HAIRLINE, backgroundColor: c.border }} />
            ) : null}

            <Pressable
              onPress={() => router.push('/add-server')}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: Spacing.three,
                padding: Spacing.three,
                backgroundColor: pressed ? c.backgroundSelected : 'transparent',
              })}>
              <Image source="sf:plus" tintColor={c.primary} style={{ width: 17, height: 17 }} />
              <Text style={{ ...Type.body, color: c.primary }}>Add a server</Text>
            </Pressable>
          </View>

          <Text style={{ ...Type.footnote, color: c.textTertiary, paddingHorizontal: Spacing.one }}>
            Tap to switch. Press and hold to sign out.
          </Text>
        </Section>
      </ScrollView>
    </>
  );
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
