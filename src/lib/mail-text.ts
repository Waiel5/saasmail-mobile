import type { Message } from './types';

/**
 * Keep this module import-free: `scripts/check-mail-text.ts` runs it outside a
 * React Native runtime. Anything reaching expo-* belongs in `compose.ts`.
 */

/** Good enough to catch a typo before a round-trip; the server is authoritative. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/**
 * Not an RFC 5322 parser: it splits on every comma, so a display name like
 * `"Smith, Jane" <j@x.com>` comes back as two entries.
 */
export function parseAddressList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * `&` must be replaced before the others. Reverse the order and the entities
 * this emits get escaped again, so `<` reaches the recipient as `&amp;lt;`.
 */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n/g, '<br>'))
    .filter((block) => block.trim().length > 0);

  if (paragraphs.length === 0) return '';
  return paragraphs.map((p) => `<p>${p}</p>`).join('\n');
}

/**
 * Hides the footer `lib/send.ts` appends outbound, so received mail keeps its
 * own. The separator is `---`, not the RFC 3676 `-- `, which is also why the
 * web app's signature stripper misses it.
 */
export function stripUnsubscribeFooter(text: string): string {
  return text.replace(/\n{2,}---\nUnsubscribe:\s*\S+\s*$/, '').trimEnd();
}

export function stripUnsubscribeFooterHtml(html: string): string {
  return html
    .replace(
      /<hr\s*\/?>\s*<p[^>]*>\s*<a[^>]*>\s*Unsubscribe\s*<\/a>\s*<\/p>\s*$/i,
      '',
    )
    .trimEnd();
}

/**
 * The server stores `signatureHtml` but never applies it on send — the web
 * composer appends it client-side, so skipping this leaves phone mail unsigned.
 * The stored value is sanitized server-side on write, hence not escaped here.
 */
export function withSignature(
  bodyHtml: string,
  signatureHtml: string | null | undefined,
): string {
  const signature = signatureHtml?.trim();
  if (!signature) return bodyHtml;
  return bodyHtml ? `${bodyHtml}\n<br>\n${signature}` : signature;
}

/**
 * True when the text part can be rendered instead of the HTML one. Entities are
 * decoded with `&amp;` last, mirroring `textToHtml`: decode it first and
 * `&amp;lt;` collapses to `<` and falsely matches.
 */
export function htmlAddsNothing(html: string, text: string): boolean {
  if (!text.trim()) return false;

  // Text equivalence alone is not enough: a promo mail can be one word inside a
  // table with a hero image and strip down to exactly its text part. These are
  // the elements carrying meaning the text part structurally cannot.
  if (
    /<\s*(img|table|a|style|h[1-6]|ul|ol|blockquote|hr|font|figure|video|iframe)\b/i.test(
      html,
    )
  ) {
    return false;
  }

  const stripped = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

  const flatten = (value: string) => value.replace(/\s+/g, " ").trim();
  return flatten(stripped) === flatten(text);
}

const MAX_CC = 50;

export function replyCc(message: Message): string {
  // Seeded with the addresses to exclude and grown as each is taken, so the one
  // set both filters and dedupes.
  const seen = new Set(
    [message.recipient, message.fromAddress]
      .filter((a): a is string => !!a)
      .map((a) => a.trim().toLowerCase()),
  );

  const roster: string[] = [];
  // The To line counts too. A reply-all that carries only Cc drops anyone who
  // was addressed directly alongside you.
  const candidates = [
    ...parseAddressList(message.toAddress ?? '').map((email) => ({ email })),
    ...(message.cc ?? []),
  ];
  for (const entry of candidates) {
    const email = entry.email.trim();
    const lower = email.toLowerCase();
    if (!email || seen.has(lower)) continue;
    seen.add(lower);
    roster.push(email);
    // The send routes cap cc at 50 and 400 past it.
    if (roster.length >= MAX_CC) break;
  }
  return roster.join(', ');
}
