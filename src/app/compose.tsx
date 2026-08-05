import { Stack } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function ComposeScreen() {
  const c = useTheme();
  return (
    <>
      <Stack.Screen options={{ title: 'New message', presentation: 'modal' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: Spacing.four }}>
        <Text style={{ ...Type.callout, color: c.textSecondary }}>
          Composing is not wired up yet.
        </Text>
      </ScrollView>
    </>
  );
}
