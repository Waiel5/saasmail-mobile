/**
 * Unsent messages, stored on the device.
 *
 * Local because there is nowhere else. saasmail has no draft storage of any
 * kind — no table, no endpoint — so a draft that is not on this phone does not
 * exist. That has one consequence worth stating plainly rather than
 * discovering: drafts do not sync. Start a message on a phone and it is not on
 * the tablet, and signing out of a server takes its drafts with it.
 *
 * It also means the body of an unsent message sits in application storage in
 * the clear. That is a real trade and it is the same one Mail makes, for the
 * same reason: a draft that does not survive the app being killed is not a
 * draft, it is a form. What is stored is only what the user has typed here —
 * received mail is still never persisted (see `lib/query.ts`).
 *
 * SQLite rather than the key-value store the server list uses: drafts are rows
 * that want ordering and a per-server filter, and re-serialising an array of
 * whole message bodies on every keystroke of an autosave is the wrong shape.
 */
import { openDatabaseSync } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';

export interface Draft {
  id: string;
  serverId: string;
  to: string;
  cc: string;
  from: string;
  subject: string;
  body: string;
  /** Set when this draft is a reply; the id of the message being answered. */
  replyToEmailId: string | null;
  /** Who the reply goes to, so the list can name it without a fetch. */
  replyToLabel: string | null;
  updatedAt: number;
}

const db = openDatabaseSync('saasmail-drafts.db');

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY NOT NULL,
    serverId TEXT NOT NULL,
    toAddress TEXT NOT NULL DEFAULT '',
    cc TEXT NOT NULL DEFAULT '',
    fromAddress TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    replyToEmailId TEXT,
    replyToLabel TEXT,
    updatedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS drafts_by_server ON drafts (serverId, updatedAt DESC);
`);

type Row = {
  id: string;
  serverId: string;
  toAddress: string;
  cc: string;
  fromAddress: string;
  subject: string;
  body: string;
  replyToEmailId: string | null;
  replyToLabel: string | null;
  updatedAt: number;
};

function toDraft(row: Row): Draft {
  return {
    id: row.id,
    serverId: row.serverId,
    to: row.toAddress,
    cc: row.cc,
    from: row.fromAddress,
    subject: row.subject,
    body: row.body,
    replyToEmailId: row.replyToEmailId,
    replyToLabel: row.replyToLabel,
    updatedAt: row.updatedAt,
  };
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeDrafts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Snapshots cached per server, invalidated on write.
 *
 * `useSyncExternalStore` compares by identity and re-renders on any new
 * reference, so returning a freshly-mapped array from every read loops until
 * React gives up with "Maximum update depth exceeded" — the same trap the
 * server list hit. A version counter that only moves on write makes the
 * reference stable while nothing has changed.
 */
let version = 0;
const cache = new Map<string, { version: number; rows: Draft[] }>();
const EMPTY: Draft[] = [];

function invalidate() {
  version += 1;
  cache.clear();
  listeners.forEach((fn) => fn());
}

export function listDrafts(serverId: string | null | undefined): Draft[] {
  if (!serverId) return EMPTY;
  const hit = cache.get(serverId);
  if (hit && hit.version === version) return hit.rows;

  const rows = db
    .getAllSync<Row>(
      'SELECT * FROM drafts WHERE serverId = ? ORDER BY updatedAt DESC',
      serverId,
    )
    .map(toDraft);

  cache.set(serverId, { version, rows });
  return rows;
}

export function getDraft(id: string): Draft | null {
  const row = db.getFirstSync<Row>('SELECT * FROM drafts WHERE id = ?', id);
  return row ? toDraft(row) : null;
}

export function countDrafts(serverId: string | null | undefined): number {
  return listDrafts(serverId).length;
}

/** True when there is nothing worth keeping — every field blank. */
export function isBlank(
  draft: Pick<Draft, 'to' | 'cc' | 'subject' | 'body'>,
): boolean {
  return (
    !draft.to.trim() &&
    !draft.cc.trim() &&
    !draft.subject.trim() &&
    !draft.body.trim()
  );
}

/**
 * Write a draft, returning its id.
 *
 * The id is generated here when absent so a compose screen can call this
 * repeatedly as the user types and keep updating one row rather than
 * accumulating one per keystroke.
 */
export function saveDraft(
  draft: Omit<Draft, 'id' | 'updatedAt'> & { id?: string },
): string {
  const id = draft.id ?? randomUUID();
  db.runSync(
    `INSERT INTO drafts
       (id, serverId, toAddress, cc, fromAddress, subject, body, replyToEmailId, replyToLabel, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       serverId = excluded.serverId,
       toAddress = excluded.toAddress,
       cc = excluded.cc,
       fromAddress = excluded.fromAddress,
       subject = excluded.subject,
       body = excluded.body,
       replyToEmailId = excluded.replyToEmailId,
       replyToLabel = excluded.replyToLabel,
       updatedAt = excluded.updatedAt`,
    [
      id,
      draft.serverId,
      draft.to,
      draft.cc,
      draft.from,
      draft.subject,
      draft.body,
      draft.replyToEmailId,
      draft.replyToLabel,
      Math.floor(Date.now() / 1000),
    ],
  );
  invalidate();
  return id;
}

export function deleteDraft(id: string): void {
  db.runSync('DELETE FROM drafts WHERE id = ?', id);
  invalidate();
}

/**
 * Drop every draft belonging to a server.
 *
 * Called when an account is removed. Leaving them would strand unsent messages
 * addressed from an account the app can no longer send through, and they would
 * silently reappear if the same deployment were added again later.
 */
export function deleteDraftsForServer(serverId: string): void {
  db.runSync('DELETE FROM drafts WHERE serverId = ?', serverId);
  invalidate();
}
