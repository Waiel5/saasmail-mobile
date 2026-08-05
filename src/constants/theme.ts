/**
 * The saasmail design system.
 *
 * The light values are lifted from the web app's tokens (`src/index.css`) so the
 * two read as siblings rather than unrelated products: lime primary, violet
 * reserved for unread and focus, near-white surfaces.
 *
 * The dark values are *derived*, not inverted. The web app is light-only, so
 * there was nothing to copy, and a mail client that cannot go dark feels broken
 * on a phone. Two rules shaped them:
 *
 *  - Surfaces are near-black rather than pure black. #000 on OLED smears
 *    visibly while scrolling a long list, which a mail app does constantly.
 *  - Accents are lightened, not reused. Lime at 32% lightness fails contrast
 *    against a dark surface, so the dark palette raises it to ~52% to stay
 *    legible as a text and icon colour.
 *
 * Typography is the platform's own font rather than the web app's Inter. On iOS
 * the system font is San Francisco — what Mail, Messages and Notes use — and
 * substituting a webfont is the most reliable way to make an app read as a
 * website in a wrapper. Inter was drawn as an SF-alike, so the brand loses
 * almost nothing, and this ships no font files at all.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    /** Page background. hsl(0 0% 99%) */
    background: '#FCFCFC',
    /** Grouped-list background, one step down from the page. hsl(220 14% 96%) */
    backgroundSubtle: '#F1F3F5',
    /** Pressed / selected row. hsl(220 13% 91%) */
    backgroundSelected: '#E7E9EC',
    /** Cards and rows sitting on top of the page. */
    surface: '#FFFFFF',
    /** Hairlines. hsl(220 13% 91%) */
    border: '#E7E9EC',

    /** hsl(222 47% 11%) */
    text: '#0F172A',
    /** hsl(215 16% 47%) */
    textSecondary: '#64748B',
    /** hsl(215 16% 65%) — timestamps, metadata */
    textTertiary: '#94A3B8',

    /** hsl(75 100% 32%) — CTAs and the send action. */
    primary: '#7AA300',
    /** Text and icons drawn on `primary`. */
    onPrimary: '#FFFFFF',
    /** hsl(75 70% 94%) — selected chips, subtle emphasis. */
    primarySubtle: '#F0FADB',

    /**
     * hsl(254 95% 55%). Reserved for unread dots and focus rings only. Spending
     * it anywhere else destroys the one signal the list has, since unread is
     * the sole per-message state this API can express.
     */
    unread: '#521FF9',

    danger: '#DC2626',
    dangerSubtle: '#FEE9E9',
    success: '#26A05A',
    warning: '#B45309',
  },

  dark: {
    background: '#0B0D10',
    backgroundSubtle: '#14171C',
    backgroundSelected: '#1C2027',
    surface: '#14171C',
    border: '#262B33',

    text: '#E8EBEF',
    textSecondary: '#9BA3AF',
    textTertiary: '#6B7280',

    /** hsl(75 75% 52%) — lifted from the light 32% so it passes contrast. */
    primary: '#B3E029',
    /** Dark text on bright lime; white would be unreadable. */
    onPrimary: '#0B0D10',
    primarySubtle: '#20260F',

    /** hsl(254 95% 70%) — same hue, lifted for a dark surface. */
    unread: '#8C6AFB',

    danger: '#F87171',
    dangerSubtle: '#2A1416',
    success: '#4ADE80',
    warning: '#FBBF24',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
})!;

/**
 * Type scale, tracking the platform's own sizes so text lands where a user
 * expects. `lineHeight` is explicit because RN's default leading is too tight
 * for the multi-line previews this app is mostly made of.
 */
export const Type = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  /** Message bodies and row primary text. */
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400' },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** Timestamps, counts, metadata. */
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
} as const;

/** 4pt grid. Named rather than numbered so call sites read as intent. */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 24,
  six: 32,
  seven: 48,
} as const;

/** Matches the web app's radii exactly (`--radius-*`). */
export const Radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  xxl: 16,
  /** Pills: buttons and unread badges. */
  full: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/** Hairline that stays one physical pixel at any density. */
export const HAIRLINE = Platform.select({ ios: 0.33, default: 0.5 })!;
