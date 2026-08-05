import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { setActiveServerId } from '@/lib/servers';
import { useActiveServer, useServers } from '@/lib/use-servers';

/**
 * The active server, as a tappable navigation title.
 *
 * Switching lives here rather than in Settings because for this app it is not a
 * setting — it is the frame everything else is read through. A user with a work
 * deployment and a client's deployment changes it many times a day, and burying
 * that behind a tab costs them a detour every time. Apps whose accounts are
 * similarly load-bearing put it in the same place.
 *
 * With one server the pill renders as plain text with no chevron: there is
 * nothing to switch to, and an affordance that opens a sheet containing a
 * single row is a small lie.
 */
export function ServerSwitcherTitle() {
  const c = useTheme();
  const router = useRouter();
  const servers = useServers();
  const active = useActiveServer();
  const [open, setOpen] = useState(false);

  if (!active) return null;
  const multiple = servers.length > 1;

  return (
    <>
      <Pressable
        disabled={!multiple}
        onPress={async () => {
          if (process.env.EXPO_OS === 'ios') {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          setOpen(true);
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 1 }}>
        <Text numberOfLines={1} style={{ ...Type.headline, color: c.text }}>
          {active.brandName}
        </Text>
        {multiple ? (
          <Image
            source="sf:chevron.down"
            tintColor={c.textSecondary}
            style={{ width: 11, height: 11 }}
          />
        ) : null}
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: c.backgroundSubtle }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: Spacing.four,
            }}>
            <Text style={{ ...Type.title, color: c.text }}>Servers</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <Text style={{ ...Type.body, color: c.primary }}>Done</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: Spacing.four, gap: Spacing.four }}>
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
                    onPress={async () => {
                      setActiveServerId(server.id);
                      if (process.env.EXPO_OS === 'ios') {
                        await Haptics.selectionAsync();
                      }
                      setOpen(false);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: Spacing.three,
                      padding: Spacing.three,
                      backgroundColor: pressed ? c.backgroundSelected : 'transparent',
                    })}>
                    {/* Colour derived from the host, so two deployments are
                        distinguishable at a glance even when both are called
                        "saasmail" — which, unbranded, they both are. */}
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: Radius.lg,
                        borderCurve: 'continuous',
                        backgroundColor: hostTint(server.origin),
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <Text style={{ ...Type.subhead, fontWeight: '700', color: '#FFFFFF' }}>
                        {server.brandName.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>

                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={{ ...Type.body, color: c.text }}>{server.brandName}</Text>
                      <Text numberOfLines={1} style={{ ...Type.footnote, color: c.textSecondary }}>
                        {new URL(server.origin).host}
                      </Text>
                    </View>

                    {server.id === active.id ? (
                      <Image
                        source="sf:checkmark"
                        tintColor={c.primary}
                        style={{ width: 16, height: 16 }}
                      />
                    ) : null}
                  </Pressable>
                </View>
              ))}
            </View>

            <Pressable
              onPress={() => {
                setOpen(false);
                router.push('/add-server');
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: Spacing.two,
                padding: Spacing.three,
                backgroundColor: c.surface,
                borderRadius: Radius.xl,
                borderCurve: 'continuous',
              }}>
              <Image source="sf:plus" tintColor={c.primary} style={{ width: 16, height: 16 }} />
              <Text style={{ ...Type.body, color: c.primary }}>Add a server</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

/** Stable hue per host, so a server keeps the same colour across launches. */
function hostTint(origin: string): string {
  let hash = 0;
  for (let i = 0; i < origin.length; i++) hash = (hash * 31 + origin.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 45%)`;
}
