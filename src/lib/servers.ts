/**
 * Credentials are one JSON value per server in `expo-secure-store`: split into
 * two writes, a crash between them strands a new access token beside a spent
 * refresh token. Non-secret fields live in ordinary storage so the server list
 * renders without any keychain access.
 */
import * as SecureStore from 'expo-secure-store';
import 'expo-sqlite/localStorage/install';

export interface ServerCapabilities {
  oauthApi: boolean;
  oauthStream: boolean;
}

export interface ServerRecord {
  /** Canonical https origin, no trailing slash. Also the identity of the row. */
  id: string;
  origin: string;
  brandName: string;
  clientId: string;
  apiVersion: number;
  capabilities: ServerCapabilities;
  userId?: string;
  userEmail?: string;
  /** "admin" | "member". Advisory only; the server enforces it regardless. */
  role?: string;
  addedAt: number;
}

export interface ServerCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Epoch seconds. */
  expiresAt: number;
  /**
   * Bumped on every successful refresh and on sign-out. Capture it before
   * refreshing and discard the result if it moved, or a refresh that lands
   * after a sign-out resurrects credentials the user already discarded.
   */
  generation: number;
}

const SERVERS_KEY = 'saasmail.servers';
const ACTIVE_KEY = 'saasmail.activeServer';

/** SecureStore keys must be alphanumeric plus ._- so the origin is encoded. */
function credentialsKey(id: string): string {
  return `saasmail_cred_${id.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/**
 * The origin is the row identity and the server's issuer, JWT audience and
 * passkey RP ID, so `https://x.com` and `https://x.com/` must not become two
 * rows. Anything that is not https is rejected, never silently upgraded.
 */
export function canonicalizeOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // Allow http only for loopback, so a maintainer can point at `expo start`.
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    return null;
  }
  return url.origin;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// `useSyncExternalStore` compares snapshots by identity, so parsing on every
// call returns a fresh array and loops until "Maximum update depth exceeded".
// Cache against the raw string so the reference is new only on a real change.
let snapshotRaw: string | null = null;
let snapshot: ServerRecord[] = [];

export function listServers(): ServerRecord[] {
  const raw = localStorage.getItem(SERVERS_KEY);
  if (raw === snapshotRaw) return snapshot;
  snapshotRaw = raw;
  if (!raw) {
    snapshot = [];
    return snapshot;
  }
  try {
    snapshot = JSON.parse(raw) as ServerRecord[];
  } catch {
    snapshot = [];
  }
  return snapshot;
}

export function getServer(id: string): ServerRecord | undefined {
  return listServers().find((s) => s.id === id);
}

export function getActiveServerId(): string | null {
  return localStorage.getItem(ACTIVE_KEY) ?? listServers()[0]?.id ?? null;
}

export function setActiveServerId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
  emit();
}

export function upsertServer(record: ServerRecord): void {
  // Copy: `listServers()` hands back the cached snapshot React is rendering
  // from, and mutating it changes the screen with no re-render requested.
  const servers = [...listServers()];
  const i = servers.findIndex((s) => s.id === record.id);
  if (i >= 0) servers[i] = { ...servers[i], ...record };
  else servers.push(record);
  localStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
  if (!localStorage.getItem(ACTIVE_KEY)) localStorage.setItem(ACTIVE_KEY, record.id);
  emit();
}

export async function readCredentials(id: string): Promise<ServerCredentials | null> {
  const raw = await SecureStore.getItemAsync(credentialsKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServerCredentials;
  } catch {
    return null;
  }
}

export async function writeCredentials(
  id: string,
  creds: ServerCredentials,
): Promise<void> {
  await SecureStore.setItemAsync(credentialsKey(id), JSON.stringify(creds), {
    // Never back up or sync: that hands another device a session the user
    // never authorized there.
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/**
 * Credentials first: if this dies midway, an orphaned keychain token for a
 * server the UI no longer lists cannot be revoked from here.
 */
export async function removeServer(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(credentialsKey(id));

  const servers = listServers().filter((s) => s.id !== id);
  localStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
  if (localStorage.getItem(ACTIVE_KEY) === id) {
    if (servers[0]) localStorage.setItem(ACTIVE_KEY, servers[0].id);
    else localStorage.removeItem(ACTIVE_KEY);
  }
  emit();
}

/** Bumps the generation only, so an in-flight refresh is discarded when it lands. */
export async function invalidateGeneration(id: string): Promise<void> {
  const creds = await readCredentials(id);
  if (!creds) return;
  await writeCredentials(id, { ...creds, generation: creds.generation + 1 });
}
