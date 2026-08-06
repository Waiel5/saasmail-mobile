import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { countDrafts } from '@/lib/drafts';
import { deleteDraftsForServer } from '@/lib/drafts';
import { forgetServer } from '@/lib/query';
import { removeServer, setActiveServerId, type ServerRecord } from '@/lib/servers';
import { useDrafts } from '@/lib/use-drafts';
import { useActiveServerId, useServers } from '@/lib/use-servers';

export default function SettingsScreen() {
  const c = useTheme();
  const router = useRouter();
  const servers = useServers();
  const activeId = useActiveServerId();
  const active = servers.find((s) => s.id === activeId) ?? null;
  const drafts = useDrafts(activeId);

  async function signOut(server: ServerRecord) {
    const pending = countDrafts(server.id);
    Alert.alert(
      `Sign out of ${server.brandName}?`,
      'This removes the account from this device. Nothing on the server changes.' +
        (pending > 0
          ? `\n\n${pending} unsent ${pending === 1 ? 'draft' : 'drafts'} will be deleted. Drafts are stored only on this device.`
          : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await forgetServer(server.id);
            await removeServer(server.id);
            // After removeServer: a failure there leaves the account listed,
            // and drafts belonging to a listed account must not already be gone.
            deleteDraftsForServer(server.id);
          },
        },
      ],
    );
  }

  const version =
    Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '—';

  return (
    <>
      <Stack.Screen options={{ title: 'Settings', headerLargeTitle: true }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: Spacing.four, gap: Spacing.five }}>
        {active ? (
          <Section title="Account" footer="Your role is set on the server.">
            <Card>
              <Row label="Signed in as" value={active.userEmail ?? '—'} />
              <Divider />
              <Row
                label="Role"
                value={active.role === 'admin' ? 'Admin' : 'Member'}
              />
              <Divider />
              <Row label="Server" value={new URL(active.origin).host} />
              <Divider />
              <Tap
                label="Open in browser"
                tint={c.primary}
                icon="sf:safari"
                onPress={() => Linking.openURL(active.origin).catch(() => {})}
              />
            </Card>
          </Section>
        ) : null}

        <Section
          title={servers.length > 1 ? 'Servers' : 'Server'}
          footer={
            servers.length > 1
              ? 'Tap an account to switch to it.'
              : 'saasmail is self-hosted, so you can connect more than one deployment.'
          }>
          <Card>
            {servers.map((server, i) => (
              <View key={server.id}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() => setActiveServerId(server.id)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: Spacing.three,
                    padding: Spacing.three,
                    backgroundColor: pressed
                      ? c.backgroundSelected
                      : 'transparent',
                  })}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ ...Type.body, color: c.text }}>
                      {server.brandName}
                    </Text>
                    <Text style={{ ...Type.footnote, color: c.textSecondary }}>
                      {server.userEmail ?? new URL(server.origin).host}
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

            {servers.length > 0 ? <Divider /> : null}
            <Tap
              label="Add a Server"
              tint={c.primary}
              icon="sf:plus"
              onPress={() => router.push('/add-server')}
            />
          </Card>
        </Section>

        <Section title="Drafts" footer="Drafts live on this device and do not sync.">
          <Card>
            <Tap
              label={
                drafts.length > 0
                  ? `${drafts.length} unsent ${drafts.length === 1 ? 'draft' : 'drafts'}`
                  : 'No unsent drafts'
              }
              tint={drafts.length > 0 ? c.text : c.textTertiary}
              icon="sf:square.and.pencil"
              disabled={drafts.length === 0}
              onPress={() => router.push('/drafts')}
            />
          </Card>
        </Section>

        {active ? (
          <Section title="About">
            <Card>
              <Row label="Version" value={version} />
            </Card>
          </Section>
        ) : null}

        {/* Its own group, away from anything routine. */}
        {servers.map((server) => (
          <Card key={`out-${server.id}`}>
            <Tap
              label={
                servers.length > 1
                  ? `Sign Out of ${server.brandName}`
                  : 'Sign Out'
              }
              tint={c.danger}
              icon="sf:rectangle.portrait.and.arrow.right"
              onPress={() => signOut(server)}
            />
          </Card>
        ))}
      </ScrollView>
    </>
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

function Row({ label, value }: { label: string; value: string }) {
  const c = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.three,
        padding: Spacing.three,
      }}>
      <Text style={{ ...Type.body, color: c.text }}>{label}</Text>
      <Text
        selectable
        numberOfLines={1}
        style={{ ...Type.body, flex: 1, textAlign: 'right', color: c.textSecondary }}>
        {value}
      </Text>
    </View>
  );
}

function Tap({
  label,
  tint,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  tint: string;
  icon: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.three,
        padding: Spacing.three,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: pressed ? c.backgroundSelected : 'transparent',
      })}>
      <Image source={icon} tintColor={tint} style={{ width: 17, height: 17 }} />
      <Text style={{ ...Type.body, color: tint }}>{label}</Text>
    </Pressable>
  );
}

function Section({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: string;
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
      {footer ? (
        <Text
          style={{
            ...Type.footnote,
            color: c.textTertiary,
            paddingHorizontal: Spacing.one,
          }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}
