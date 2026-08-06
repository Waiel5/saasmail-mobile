/**
 * Errors arrive as `{ error }`, sometimes with a `code` of PASSKEY_REQUIRED or
 * OAUTH_INSUFFICIENT_SCOPE, and sometimes as bare text with no JSON at all.
 * Collapsing them into one Error puts the client in a refresh loop against a
 * failure no new token can fix.
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
    readonly code?: string,
  ) {
    super(message);
  }

  /** True when signing in again would not help. */
  get isTerminal(): boolean {
    return this.kind === 'passkey-required' || this.kind === 'insufficient-scope';
  }
}

// One refresh at a time per server. Requests 401 in batches, and because
// better-auth rotates the refresh token, a second concurrent exchange
// invalidates the first one's result and signs the user out.
const inFlightRefresh = new Map<string, Promise<ServerCredentials | null>>();

async function refreshOnce(server: ServerRecord): Promise<ServerCredentials | null> {
  const existing = inFlightRefresh.get(server.id);
  if (existing) return existing;

  const attempt = (async () => {
    try {
      const current = await readCredentials(server.id);
      if (!current?.refreshToken) return null;

      // Captured before the network call: if it moved, the user signed out or
      // re-authenticated meanwhile and this result must not be written.
      const generation = current.generation;

      let next: ServerCredentials;
      try {
        next = await refreshCredentials(server, current);
      } catch {
        return null;
      }

      // Past the exchange the stored refresh token is spent, so a keychain
      // failure here is unrecoverable and must not read as "refresh failed".
      try {
        const now = await readCredentials(server.id);
        if (!now || now.generation !== generation) return now;
        await writeCredentials(server.id, next);
      } catch {
        throw new ApiError(
          'This session could not be saved to the keychain. Remove this server and add it again.',
          'unauthorized',
          401,
        );
      }
      return next;
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
    // Not JSON: `assertInboxAllowed` throws an HTTPException whose body is the
    // bare string "Inbox not allowed", with no onError handler wrapping it.
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
 * Every call names its server; there is no ambient "current server". A refetch
 * resolving against whichever server is active when it lands would show one
 * account's mail under another's name.
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
  try {
    return JSON.parse(text) as T;
  } catch {
    // A 200 of HTML is a captive portal, a proxy login page or the wrong host.
    throw new ApiError(
      'That address answered, but not like a saasmail server.',
      'server',
      res.status,
    );
  }
}

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
