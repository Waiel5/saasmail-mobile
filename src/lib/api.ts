/**
 * Talking to a saasmail deployment.
 *
 * Deliberately not a port of the web app's `apiFetch`. That one throws away
 * error bodies (`throw new Error("API error: " + res.status)`), which is
 * survivable in a browser where the user can open devtools and is not here:
 * this API answers with at least four distinct shapes, and two of them are
 * actionable rather than fatal.
 *
 *   { error }                        — ordinary failure
 *   { error, code: "PASSKEY_REQUIRED" }        — fixable, but not by retrying
 *   { error, code: "OAUTH_INSUFFICIENT_SCOPE" } — fixable by re-consenting
 *   "Inbox not allowed"              — bare text, no JSON at all
 *
 * Collapsing those into one Error is how a client ends up in a refresh loop
 * against a failure no new token can fix.
 */
import {
  getServer,
  readCredentials,
  writeCredentials,
  type ServerCredentials,
  type ServerRecord,
} from './servers';
import { refreshCredentials } from './auth';

export type ApiErrorKind =
  | 'unauthorized'
  | 'passkey-required'
  | 'insufficient-scope'
  | 'forbidden'
  | 'not-found'
  | 'server'
  | 'network';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status: number,
    /** Server-supplied code, when there was one. */
    readonly code?: string,
  ) {
    super(message);
  }

  /** True when signing in again would not help. */
  get isTerminal(): boolean {
    return this.kind === 'passkey-required' || this.kind === 'insufficient-scope';
  }
}

/**
 * One refresh at a time per server.
 *
 * Several requests routinely 401 together — a screen mounting fires three
 * queries at once. Without this each would refresh independently, and because
 * better-auth rotates the refresh token, the second exchange invalidates the
 * first one's result and the user is signed out by their own client.
 */
const inFlightRefresh = new Map<string, Promise<ServerCredentials | null>>();

async function refreshOnce(server: ServerRecord): Promise<ServerCredentials | null> {
  const existing = inFlightRefresh.get(server.id);
  if (existing) return existing;

  const attempt = (async () => {
    const current = await readCredentials(server.id);
    if (!current?.refreshToken) return null;

    // Captured before the network call. If it has moved by the time we return,
    // the user signed out or re-authenticated meanwhile and this result would
    // resurrect credentials they had already discarded.
    const generation = current.generation;

    try {
      const next = await refreshCredentials(server, current);
      const now = await readCredentials(server.id);
      if (!now || now.generation !== generation) return now;
      await writeCredentials(server.id, next);
      return next;
    } catch {
      return null;
    } finally {
      inFlightRefresh.delete(server.id);
    }
  })();

  inFlightRefresh.set(server.id, attempt);
  return attempt;
}

async function parseError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => '');
  let body: { error?: string; code?: string } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON — `assertInboxAllowed` throws an HTTPException whose body is the
    // bare string "Inbox not allowed", because no onError handler wraps it.
    body = null;
  }

  const message = body?.error ?? (text || `Request failed (${res.status})`);
  const code = body?.code;

  if (code === 'PASSKEY_REQUIRED') {
    return new ApiError(
      'This account needs a passkey before the app can use it.',
      'passkey-required',
      res.status,
      code,
    );
  }
  if (code === 'OAUTH_INSUFFICIENT_SCOPE' || code === 'OAUTH_SCOPE_DENIED') {
    return new ApiError(message, 'insufficient-scope', res.status, code);
  }

  const kind: ApiErrorKind =
    res.status === 401
      ? 'unauthorized'
      : res.status === 403
        ? 'forbidden'
        : res.status === 404
          ? 'not-found'
          : 'server';

  return new ApiError(message, kind, res.status, code);
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set internally to stop a refreshed request from refreshing again. */
  retried?: boolean;
}

/**
 * Perform an authenticated request against a specific server.
 *
 * Every call names its server. There is no ambient "current server" here on
 * purpose: a background refetch that resolved against whichever server happened
 * to be active would show one account's mail under another's name.
 */
export async function apiFetch<T>(
  serverId: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const server = getServer(serverId);
  if (!server) throw new ApiError('Server not found', 'not-found', 0);

  const creds = await readCredentials(serverId);
  if (!creds) throw new ApiError('Signed out', 'unauthorized', 401);

  const { body, retried, headers, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  let res: Response;
  try {
    res = await fetch(`${server.origin}${path}`, {
      ...rest,
      headers: {
        Accept: 'application/json',
        ...(isFormData ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
        Authorization: `Bearer ${creds.accessToken}`,
      },
      body: isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('No connection', 'network', 0);
  }

  if (res.status === 401 && !retried) {
    const next = await refreshOnce(server);
    if (next) {
      return apiFetch<T>(serverId, path, { ...options, retried: true });
    }
  }

  if (!res.ok) throw await parseError(res);

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** An authenticated URL plus headers, for `expo-image` and attachment fetches. */
export async function authorizedSource(
  serverId: string,
  path: string,
): Promise<{ uri: string; headers: Record<string, string> } | null> {
  const server = getServer(serverId);
  const creds = await readCredentials(serverId);
  if (!server || !creds) return null;
  return {
    uri: `${server.origin}${path}`,
    headers: { Authorization: `Bearer ${creds.accessToken}` },
  };
}
