import { Text, View } from 'react-native';

import { Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { rowInitials, type PersonRow } from '@/lib/types';

/** Spread around the wheel; 60-85 is skipped because it reads as the brand lime. */
const HUES = [4, 26, 44, 100, 150, 176, 198, 218, 250, 282, 312, 338];

function hueFor(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(index)) | 0;
  }
  return HUES[Math.abs(hash) % HUES.length];
}

/** Circular avatar, hashed from the address so a correspondent keeps one colour. */
export function SenderAvatar({
  address,
  name,
  size = 40,
}: {
  address: string;
  name?: string | null;
  size?: number;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';

  // `rowTitle` reads only these two on a person row, so the rest is never touched.
  const initials =
    rowInitials({ type: 'person', email: address, name: name ?? null } as PersonRow) ||
    '?';

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: Radius.full,
        // 33% fails 4.5:1 on white (hue 176); dark needs 63% or more on #0B0D10 (hue 250).
        backgroundColor: `hsl(${hueFor(address.trim().toLowerCase())}, 58%, ${dark ? 68 : 32}%)`,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {/* Not a text token: those track the page, and this sits on a generated fill. */}
      <Text
        style={{
          ...Type.subhead,
          fontWeight: '600',
          color: dark ? c.background : '#FFFFFF',
        }}>
        {initials}
      </Text>
    </View>
  );
}
