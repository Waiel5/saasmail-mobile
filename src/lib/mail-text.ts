/**
 * Pure text handling for outbound mail.
 *
 * Kept free of imports on purpose. `compose.ts` reaches `apiFetch`, which
 * reaches `expo-secure-store`, so anything living beside it can only run inside
 * a React Native runtime. These four functions are where the escaping happens,
 * which is the part most worth being able to run a check against — hence a
 * module with no dependencies at all. See `scripts/check-mail-text.ts`.
 */

/** Good enough to catch a typo before a round-trip; the server is authoritative. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/**
 * Split a comma- or semicolon-separated address list.
 *
 * Deliberately not a full RFC 5322 address parser — no display names, no
 * quoted local parts, no group syntax. The field it backs is a Cc row people
 * paste plain addresses into, and a half-correct parser that accepts
 * `"Smith, Jane" <j@x.com>` and then splits it on the comma inside the quotes
 * is worse than one that never claimed to handle it.
 */
export function parseAddressList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Plain text to HTML, escaping first.
 *
 * This is a trust boundary. The result is a document rendered by someone
 * else's mail client, so an unescaped `<` is not a formatting bug — it is
 * markup the sender did not write, appearing in the recipient's inbox.
 *
 * `&` must be replaced before the others. Reverse the order and the ampersands
 * in the entities this function itself emits get escaped a second time, and the
 * recipient reads `&amp;lt;` where the sender typed `<`.
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
 * Hide the unsubscribe footer saasmail appends on the way out.
 *
 * `lib/send.ts` adds a fixed footer to every outbound message — three dashes
 * and a signed URL in the text part, an `<hr>` and a link in the HTML one. It
 * belongs in the delivered mail; it does not belong in the sender's own view
 * of their conversation, where it is machine-written boilerplate, identical on
 * every message, and in the text part several lines longer than most replies.
 *
 * The patterns are anchored to the end and match saasmail's exact output
 * rather than unsubscribe footers in general. A received newsletter keeps its
 * own footer: that one is the sender's content and hiding it would be editing
 * someone else's mail.
 *
 * Note the separator is `---`, not the RFC 3676 `-- `, so the web app's
 * signature stripper does not catch it either.
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
 * Append the inbox's signature, exactly as the web composer does.
 *
 * saasmail stores `signatureHtml` per inbox but never applies it on send — the
 * web `ReplyComposer` appends it client-side. So this is not decoration: skip
 * it and the same inbox signs its mail from a browser and does not from a
 * phone, which the recipient sees and the sender does not.
 *
 * The stored value is sanitized server-side on write, so it is trusted here in
 * a way the user's own typing is not.
 */
export function withSignature(
  bodyHtml: string,
  signatureHtml: string | null | undefined,
): string {
  const signature = signatureHtml?.trim();
  if (!signature) return bodyHtml;
  return bodyHtml ? `${bodyHtml}\n<br>\n${signature}` : signature;
}
