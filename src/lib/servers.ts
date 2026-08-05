/**
 * The set of saasmail deployments this app is signed in to.
 *
 * saasmail is self-hosted, so there is no "the" server — every user points the
 * app at their own deployment, and a person who runs several (work, a client,
 * a side project) needs all of them at once. That makes multi-server a
 * structural property rather than a feature, closer to Mastodon or Home
 * Assistant than to a single-tenant mail client.
 *
 * Storage is split deliberately:
 *
 *  - Credentials live in `expo-secure-store`, one JSON value per server holding
 *    the access and refresh token together. Keeping them in a single value is
 *    what makes a refresh atomic: written separately, a crash between the two
 *    writes leaves a new access token beside a spent refresh token, and the
 *    account is unrecoverable without signing in again.
 *  - Everything else — origin, brand name, capabilities — is not secret and
 *    lives in ordinary storage, so the server list renders before any keychain
 *    access and a locked keychain cannot blank the UI.
 */
import * as SecureStore from 'expo-secure-store';
import 'expo-sqlite/localStorage/install';

export interface ServerCapabilities {
  oauthApi: boolean;
  oauthStream: boolean;
}

/** Non-secret description of a server. Safe to render before unlocking. */
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
  /** "admin" | "member". Advisory — the server enforces it regardless. */
  role?: string;
  addedAt: number;
}

/** The secret half. Written and read as one unit, never field by field. */
export interface ServerCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Epoch seconds. */
  expiresAt: number;
  /**
   * Increments on every successful refresh and on sign-out.
   *
   * A request that 401s triggers a refresh, but by the time that refresh
   * returns the user may have signed out or switched servers. Committing its
   * result unconditionally would resurrect credentials the user had already
   * discarded. Callers capture the generation before refreshing and discard the
   * result if it moved underneath them.
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
 * Reduce a user-typed address to the exact origin the OAuth flow will use.
 *
 * The server's `BASE_URL` is the canonical identity for its issuer, JWT
 * audience and passkey RP ID, so `https://mail.example.com` and
 * `https://mail.example.com/` must not become two rows the user cannot tell
 * apart. HTTPS is required rather than defaulted-and-hoped: bearer tokens over
 * cleartext are readable by anything on the path, and the failure would be
 * silent.
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

/**
 * Parsed snapshot, cached against the raw string it came from.
 *
 * `useSyncExternalStore` compares snapshots by identity and re-renders whenever
 * it sees a new one. Parsing on every call returns a fresh array each time, so
 * React would re-render, call this again, get another new array, and loop until
 * it bails out with "Maximum update depth exceeded" — which is exactly what
 * happened. The cache makes the reference stable while the stored value is
 * unchanged, and new only when it genuinely changed.
 */
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
  // Copy rather than mutate: `listServers()` hands back the cached snapshot,
  // which React may still be rendering from. Editing it in place would change
  // what is on screen without any re-render having been requested.
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
    // The tokens are only useful while someone is using the app, and syncing
    // them to a new device would hand it a session the user never authorized
    // there.
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/**
 * Forget a server.
 *
 * Credentials go first. If the process dies midway, the worse outcome by far is
 * an orphaned token still sitting in the keychain for a server the UI no longer
 * lists — invisible, and impossible for the user to revoke from here.
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

/**
 * Bump the generation without touching the tokens, so an in-flight refresh
 * started before this point is discarded when it lands.
 */
export async function invalidateGeneration(id: string): Promise<void> {
  const creds = await readCredentials(id);
  if (!creds) return;
  await writeCredentials(id, { ...creds, generation: creds.generation + 1 });
}
