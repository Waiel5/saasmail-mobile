/**
 * Hand-transcribed from the worker's Zod schemas. The OpenAPI document is
 * served at runtime from `/doc` and is not committed, so codegen would need a
 * running deployment. These cover only what the app reads.
 */

/** The inbox list mixes both: `person` is a one-to-one timeline, `group` a thread. */
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

/** Received and sent rows, merged server-side into one shape. */
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
  /** Received only, null on sent rows. 0 or 1, not a boolean: SQLite has none. */
  isRead: number | null;
  /** Sent only. */
  status?: string | null;
  /**
   * Epoch seconds, unifying `received_at` and `sent_at`. Not `createdAt` —
   * that exists on attachment rows but not on a message, and reading it gives
   * "Invalid Date" plus a silently unsorted thread.
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
   * messages response. The server stores it but never appends it on send.
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

export function rowTitle(row: InboxRow): string {
  if (row.type === 'person') return row.name || row.email;
  const names = row.participants.map((p) => p.name || p.email);
  if (names.length === 0) return row.inbox;
  if (names.length <= 2) return names.join(' & ');
  return `${names[0]} & ${names.length - 1} others`;
}

export function rowInitials(row: InboxRow): string {
  const title = rowTitle(row);
  const words = title.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
