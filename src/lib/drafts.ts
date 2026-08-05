/**
 * Device-local only: saasmail has no draft table or endpoint, so drafts never
 * sync and signing out of a server takes its drafts with it. Bodies sit in
 * application storage in the clear; received mail is still never persisted.
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

// `useSyncExternalStore` compares snapshots by identity, so a freshly-mapped
// array on every read loops until "Maximum update depth exceeded". The version
// only moves on write, which keeps the reference stable in between.
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

/** Upsert; generates the id when absent so an autosave keeps updating one row. */
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

/** Call on account removal: ids are origins, so leftovers reappear on re-add. */
export function deleteDraftsForServer(serverId: string): void {
  db.runSync('DELETE FROM drafts WHERE serverId = ?', serverId);
  invalidate();
}
