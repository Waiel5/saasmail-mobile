/**
 * No client id is shipped: the user names a deployment at runtime and the app
 * self-registers with it (RFC 7591). Authorization must run in the system
 * browser, never a WebView: the WebAuthn ceremony needs the deployment's own
 * origin for its RP ID to match, and passkeys break otherwise.
 */
import * as AuthSession from 'expo-auth-session';

import {
  canonicalizeOrigin,
  type ServerCapabilities,
  type ServerCredentials,
  type ServerRecord,
} from './servers';

const SCOPES = ['openid', 'email', 'offline_access', 'email:read', 'email:send', 'email:manage'];

/** Requested only when the user asks for admin access on that server. */
export const ADMIN_SCOPE = 'admin:manage';

export interface ServerProbe {
  origin: string;
  brandName: string;
  apiVersion: number;
  capabilities: ServerCapabilities;
}

export class ServerError extends Error {
  constructor(
    message: string,
    readonly kind: 'unreachable' | 'not-saasmail' | 'too-old' | 'bad-url',
  ) {
    super(message);
  }
}

/**
 * Run before any authorize call: a too-old server has to fail here, not after
 * the user has completed a browser login and granted consent.
 */
export async function probeServer(input: string): Promise<ServerProbe> {
  const origin = canonicalizeOrigin(input);
  if (!origin) {
    throw new ServerError(
      'Enter an https address, for example mail.yourcompany.com',
      'bad-url',
    );
  }

  let res: Response;
  try {
    res = await fetch(`${origin}/api/config`, {
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new ServerError(`Could not reach ${new URL(origin).host}`, 'unreachable');
  }

  if (!res.ok) {
    throw new ServerError(
      `${new URL(origin).host} did not answer like a saasmail server`,
      'not-saasmail',
    );
  }

  let config: Partial<ServerProbe> & { capabilities?: Partial<ServerCapabilities> };
  try {
    config = await res.json();
  } catch {
    throw new ServerError(
      `${new URL(origin).host} did not answer like a saasmail server`,
      'not-saasmail',
    );
  }

  // Absent flags mean a build from before the handshake, which also rejects
  // bearer tokens on /api/*. Missing is false, not permission to try.
  const capabilities: ServerCapabilities = {
    oauthApi: config.capabilities?.oauthApi === true,
    oauthStream: config.capabilities?.oauthStream === true,
  };

  if (!capabilities.oauthApi) {
    throw new ServerError(
      'This server is running a version of saasmail that cannot accept app sign-ins yet. It needs updating.',
      'too-old',
    );
  }

  return {
    origin,
    brandName: typeof config.brandName === 'string' ? config.brandName : 'saasmail',
    apiVersion: typeof config.apiVersion === 'number' ? config.apiVersion : 0,
    capabilities,
  };
}

interface Discovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
}

async function discover(origin: string): Promise<Discovery> {
  const res = await fetch(`${origin}/.well-known/oauth-authorization-server`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new ServerError('This server does not advertise OAuth support', 'not-saasmail');
  }
  const doc = (await res.json()) as Record<string, string>;
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new ServerError('This server does not advertise OAuth support', 'not-saasmail');
  }
  return {
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    registrationEndpoint: doc.registration_endpoint,
  };
}

/**
 * RFC 8707 resource indicator, required on authorize, token and refresh alike.
 * Omit it and better-auth issues an opaque token that `/api/*` rejects as
 * invalid. The value must be an audience the deployment already allowlists;
 * anything else comes back as `invalid_request`.
 */
export function resourceIndicator(origin: string): string {
  return `${origin}/api/auth`;
}

/** One fixed redirect for both platforms, registered with every server. */
export function redirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: 'saasmail', path: 'auth' });
}

/**
 * `token_endpoint_auth_method: "none"` because a shipped app cannot keep a
 * secret; PKCE is what makes the flow safe instead.
 */
async function registerClient(
  origin: string,
  discovery: Discovery,
  wantsAdmin: boolean,
): Promise<string> {
  if (!discovery.registrationEndpoint) {
    throw new ServerError(
      'This server does not allow apps to register themselves',
      'not-saasmail',
    );
  }

  const scope = [...SCOPES, ...(wantsAdmin ? [ADMIN_SCOPE] : [])].join(' ');

  const res = await fetch(discovery.registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'saasmail for iOS and Android',
      redirect_uris: [redirectUri()],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
      scope,
    }),
  });

  if (!res.ok) {
    throw new ServerError(
      `${new URL(origin).host} refused to register this app`,
      'not-saasmail',
    );
  }

  const body = (await res.json()) as { client_id?: string };
  if (!body.client_id) {
    throw new ServerError('Registration did not return a client id', 'not-saasmail');
  }
  return body.client_id;
}

export interface SignInResult {
  record: Omit<ServerRecord, 'userId' | 'userEmail' | 'role'>;
  credentials: ServerCredentials;
}

/**
 * Persists nothing. The caller writes the record and credentials together once
 * it has the user's identity too, so a half-added server never appears.
 */
export async function signInToServer(
  probe: ServerProbe,
  opts: { wantsAdmin?: boolean } = {},
): Promise<SignInResult> {
  const discovery = await discover(probe.origin);
  const clientId = await registerClient(probe.origin, discovery, opts.wantsAdmin === true);

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri: redirectUri(),
    scopes: [...SCOPES, ...(opts.wantsAdmin ? [ADMIN_SCOPE] : [])],
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
    extraParams: { resource: resourceIndicator(probe.origin) },
  });

  const result = await request.promptAsync({
    authorizationEndpoint: discovery.authorizationEndpoint,
  });

  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new ServerError('Sign-in cancelled', 'unreachable');
  }
  if (result.type !== 'success' || !result.params.code) {
    const description =
      (result.type === 'error' && result.error?.description) || 'Sign-in failed';
    throw new ServerError(description, 'unreachable');
  }

  const tokens = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      code: result.params.code,
      redirectUri: redirectUri(),
      // `resource` has to be repeated at the token endpoint too; omitting it
      // drops back to an opaque token.
      extraParams: {
        ...(request.codeVerifier ? { code_verifier: request.codeVerifier } : {}),
        resource: resourceIndicator(probe.origin),
      },
    },
    { tokenEndpoint: discovery.tokenEndpoint },
  );

  return {
    record: {
      id: probe.origin,
      origin: probe.origin,
      brandName: probe.brandName,
      clientId,
      apiVersion: probe.apiVersion,
      capabilities: probe.capabilities,
      addedAt: Math.floor(Date.now() / 1000),
    },
    credentials: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt:
        tokens.issuedAt + (tokens.expiresIn ?? 3600) - 60 /* refresh a minute early */,
      generation: 1,
    },
  };
}

/** Exchange a refresh token. Callers own the single-flight and generation check. */
export async function refreshCredentials(
  server: ServerRecord,
  current: ServerCredentials,
): Promise<ServerCredentials> {
  const discovery = await discover(server.origin);
  const tokens = await AuthSession.refreshAsync(
    {
      clientId: server.clientId,
      refreshToken: current.refreshToken,
      // Drop this and the refreshed token comes back opaque, so the app
      // silently stops working after an hour.
      extraParams: { resource: resourceIndicator(server.origin) },
    },
    { tokenEndpoint: discovery.tokenEndpoint },
  );

  return {
    accessToken: tokens.accessToken,
    // better-auth rotates the refresh token; keeping the old one spends a token
    // the server has already retired.
    refreshToken: tokens.refreshToken ?? current.refreshToken,
    expiresAt: tokens.issuedAt + (tokens.expiresIn ?? 3600) - 60,
    generation: current.generation + 1,
  };
}
