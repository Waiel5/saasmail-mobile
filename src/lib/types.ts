/**
 * Response shapes, transcribed from the worker's Zod schemas.
 *
 * Hand-written rather than generated because the OpenAPI document is served at
 * runtime from `/doc` and is not committed, so codegen would need a running
 * deployment to build against — a poor dependency for a client that is meant to
 * work with any of them. These cover what the app actually reads.
 */

/**
 * The inbox list is a heterogeneous union, not a list of threads.
 *
 * A `person` row is a one-to-one timeline with somebody; a `group` row is a
 * multi-participant conversation. They sort together by recency and render in
 * the same list, so every consumer has to handle both — which is why this is a
 * discriminated union rather than an optional-fields object.
 */
export type InboxRow = PersonRow | GroupRow;

export interface PersonRow {
  type: 'person';
  id: string;
  email: string;
  name: string | null;
  lastEmailAt: number;
  unreadCount: number;
  totalCount: number;
  recipientCount: number;
  recipients: string[];
  hasAttachment: number;
}

export interface GroupRow {
  type: 'group';
  id: string;
  inbox: string;
  participants: { id: string; email: string; name: string | null }[];
  ccParticipants: { email: string; name: string | null }[];
  lastEmailAt: number;
  unreadCount: number;
  totalCount: number;
  hasAttachment: number;
}

export interface GroupedResponse {
  data: InboxRow[];
  total: number;
  page: number;
  limit: number;
}

/** A message. Received and sent rows are merged server-side into one shape. */
export interface Message {
  id: string;
  type: 'received' | 'sent';
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  /** Received only. */
  recipient?: string;
  fromAddress?: string;
  toAddress?: string;
  /**
   * Received only; null on sent rows.
   *
   * A number, not a boolean — SQLite has no boolean type and the schema is
   * `z.number().nullable()`, so this arrives as 0 or 1.
   */
  isRead: number | null;
  /** Sent only. */
  status?: string | null;
  /**
   * Epoch seconds. Named `timestamp` server-side, unifying `received_at` on
   * inbound rows with `sent_at` on outbound ones so the two can interleave.
   *
   * This was previously transcribed as `createdAt`, which exists on the
   * attachment rows but not on a message. The result was `undefined`: the
   * header rendered "Invalid Date", and — quietly, which was worse — the
   * thread's `sort` compared `NaN` to `NaN` and left the order untouched.
   */
  timestamp: number;
  attachmentCount?: number;
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  kind: string;
}

export interface Inbox {
  email: string;
  displayName: string | null;
  /** Thread mode keeps subjects and quoted history; chat strips them. */
  displayMode: 'thread' | 'chat';
  /**
   * Present on `GET /api/inboxes`, absent from the inboxes embedded in a
   * messages response. Applied client-side on send — the server stores and
   * sanitizes it but never appends it.
   */
  signatureHtml?: string | null;
}

export interface MessagesResponse {
  emails: Message[];
  inboxes: Inbox[];
}

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
}

/** Display name for a row, falling back through what the API actually provides. */
export function rowTitle(row: InboxRow): string {
  if (row.type === 'person') return row.name || row.email;
  const names = row.participants.map((p) => p.name || p.email);
  if (names.length === 0) return row.inbox;
  if (names.length <= 2) return names.join(' & ');
  return `${names[0]} & ${names.length - 1} others`;
}

/** Two-letter monogram for the avatar. */
export function rowInitials(row: InboxRow): string {
  const title = rowTitle(row);
  const words = title.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
