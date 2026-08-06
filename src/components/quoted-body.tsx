import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { MessageBody } from '@/components/message-body';
import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  htmlAddsNothing,
  stripUnsubscribeFooter,
  stripUnsubscribeFooterHtml,
} from '@/lib/mail-text';
import type { Message } from '@/lib/types';

/**
 * A message body with its trailing quoted history folded away.
 *
 * Every reply carries the whole thread again, so without this a ten-message
 * conversation is read ten times over.
 */

/** Attributions wrap mid-line, so the opener and the `wrote:` may be lines apart. */
const TEXT_QUOTE = [
  /^On\b[\s\S]{0,300}?\bwrote:[ \t]*$/m,
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^_{10,}[ \t]*$/m,
  /^From:[ \t].+\r?\n(?:Sent|Date|To|Subject):/m,
  /^>/m,
];

const HTML_QUOTE = [
  /<blockquote\b/i,
  /<div[^>]+class=["'][^"']*gmail_quote/i,
  /<div[^>]+id=["']appendonly/i,
  /<hr[^>]+id=["']?stopSpelling/i,
];

/** Below this the fold costs more taps than it saves lines. */
const MIN_QUOTE = 60;

function firstMatch(body: string, patterns: RegExp[]): number {
  let at = -1;
  for (const pattern of patterns) {
    const found = body.search(pattern);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  return at;
}

function cut(body: string, patterns: RegExp[]): { head: string; tail: string } | null {
  const at = firstMatch(body, patterns);
  // `0` means the body is nothing but quote, which is a forward, not a reply.
  if (at <= 0) return null;

  const head = body.slice(0, at).trimEnd();
  const tail = body.slice(at).trim();
  if (!head || tail.length < MIN_QUOTE) return null;
  return { head, tail };
}

/** `&amp;` last, or the entities this produces are decoded a second time. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function previewOf(value: string): string {
  const line = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!line) return 'Quoted history';
  return line.length > 140 ? `${line.slice(0, 140).trimEnd()}…` : line;
}

interface Split {
  head: Message;
  tail: Message;
  preview: string;
}

function splitQuoted(message: Message): Split | null {
  const text = message.bodyText ? stripUnsubscribeFooter(message.bodyText).trim() : '';
  const html = message.bodyHtml ? stripUnsubscribeFooterHtml(message.bodyHtml).trim() : '';

  // Mirrors MessageBody's own choice of representation. Split the other one and
  // the quote renders inline *and* collapsed underneath itself.
  const usesText = !!text && (!html || htmlAddsNothing(html, text));

  const parts = usesText ? cut(text, TEXT_QUOTE) : html ? cut(html, HTML_QUOTE) : null;
  if (!parts) return null;

  // The unused half is blanked so MessageBody cannot reconsider and fall back to
  // the representation that was never split.
  return usesText
    ? {
        head: { ...message, bodyText: parts.head, bodyHtml: null },
        tail: { ...message, bodyText: parts.tail, bodyHtml: null },
        preview: previewOf(parts.tail),
      }
    : {
        head: { ...message, bodyHtml: parts.head, bodyText: null },
        tail: { ...message, bodyHtml: parts.tail, bodyText: null },
        preview: previewOf(stripTags(parts.tail)),
      };
}

export function QuotedBody({ message, tint }: { message: Message; tint: string }) {
  const c = useTheme();
  const [expanded, setExpanded] = useState(false);
  const quoted = useMemo(() => splitQuoted(message), [message]);

  if (!quoted) return <MessageBody message={message} tint={tint} />;

  return (
    <View style={{ gap: Spacing.two }}>
      <MessageBody message={quoted.head} tint={tint} />

      <View
        style={{
          gap: Spacing.two,
          paddingLeft: Spacing.three,
          borderLeftWidth: 2,
          borderLeftColor: c.border,
        }}>
        {expanded ? (
          <MessageBody message={quoted.tail} tint={c.textSecondary} />
        ) : (
          <Text numberOfLines={2} style={{ ...Type.footnote, color: c.textTertiary }}>
            {quoted.preview}
          </Text>
        )}

        <Pressable
          onPress={() => setExpanded((open) => !open)}
          accessibilityRole="button"
          hitSlop={Spacing.two}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            gap: Spacing.one,
            paddingHorizontal: Spacing.three,
            paddingVertical: Spacing.one + 2,
            borderRadius: Radius.full,
            // backgroundSubtle is the chat bubble's own fill, and in dark it is surface too.
            backgroundColor: c.backgroundSelected,
            borderWidth: HAIRLINE,
            borderColor: c.textTertiary,
            opacity: pressed ? 0.6 : 1,
          })}>
          <Image
            source={expanded ? 'sf:chevron.up' : 'sf:ellipsis'}
            tintColor={c.textSecondary}
            style={{ width: 12, height: 12 }}
          />
          <Text style={{ ...Type.footnote, color: c.textSecondary }}>
            {expanded ? 'See Less' : 'See More'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
