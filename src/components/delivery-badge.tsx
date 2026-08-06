import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Message } from '@/lib/types';

type Theme = ReturnType<typeof useTheme>;

export type DeliveryState = 'failed' | 'retrying';

/** Only sent rows carry `status`, and `sent` / `suppressed` are not news. */
export function deliveryState(message: Message): DeliveryState | null {
  if (message.type !== 'sent') return null;
  if (message.status === 'failed') return 'failed';
  if (message.status === 'retrying') return 'retrying';
  return null;
}

export function deliveryTint(c: Theme, state: DeliveryState): string {
  return state === 'failed' ? c.danger : c.warning;
}

/** Retrying is recoverable and failed is not, so they never share a colour. */
export function DeliveryBadge({ state }: { state: DeliveryState }) {
  const c = useTheme();
  const failed = state === 'failed';
  const tint = deliveryTint(c, state);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: Spacing.one,
        paddingHorizontal: Spacing.two,
        paddingVertical: Spacing.half,
        borderRadius: Radius.sm,
        borderCurve: 'continuous',
        // Both subtle fills land under 1.2:1 on a dark card, so the ring is what reads.
        borderWidth: HAIRLINE,
        borderColor: tint,
        backgroundColor: failed ? c.dangerSubtle : c.backgroundSelected,
      }}>
      <Image
        source={failed ? 'sf:exclamationmark.triangle.fill' : 'sf:clock.arrow.circlepath'}
        tintColor={tint}
        style={{ width: 11, height: 11 }}
      />
      <Text style={{ ...Type.caption, fontWeight: '600', color: tint }}>
        {failed ? 'Failed to send' : 'Retrying'}
      </Text>
    </View>
  );
}
