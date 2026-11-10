import {
  browserJsonResponse as json,
  browserNoContentResponse,
  isIdentityJsonRequest,
  isSameOriginBrowserRequest,
  readBoundedJsonRequest,
} from '../browser-json-http.js';
import type { RequestRateLimitDecision } from '../request-rate-limit.js';
import {
  ACCOUNT_SESSION_LIFETIME_MS,
  SIGN_IN_ATTEMPT_LIFETIME_MS,
  base64Url,
  formatSessionToken,
  fromBase64Url,
  newAccountId,
  newSessionToken,
  newSignInSecret,
  pkceChallenge,
  readCookie,
  readSessionToken,
  sessionCookieName,
  setCookie,
  sha256Hex,
  signInCookieName,
  type SessionToken,
} from './account-session.js';
import {
  isAccountAvatar,
  isAccountProvider,
  accountName,
  type AccountAvatar,
  type AccountProvider,
  type AccountView,
  type LinkOutcome,
  type NewSession,
  type SignInIdentity,
  type SignInOutcome,
  type UnlinkOutcome,
} from './account-store.js';
import {
  authorizeUrl,
  availableProviders,
  exchangeSignInCode,
  type Fetch,
  type SignInConfiguration,
} from './sign-in-providers.js';

/**
 * Accounts over HTTP (ADR-052):
 *
 * - `GET /v2/auth/<provider>/start` sends the person to the provider, with
 *   the attempt (its state and PKCE verifier) in a ten-minute cookie.
 * - `GET /v2/auth/<provider>/callback` checks the attempt, learns who the
 *   person is there, signs them in (or adds the method to the signed-in
 *   account) and answers a page that tells the table, then closes the
 *   popup or returns to the table.
 * - `GET /v2/account` is who is signed in, with the providers on offer.
 * - `PATCH /v2/account` renames or changes the avatar, `POST
 *   /v2/account/sign-out` ends this session, `DELETE
 *   /v2/account/sign-in-methods/<provider>` removes a method, and `DELETE
 *   /v2/account` deletes the account. Each is same-origin only.
 */

export type AccountRoute =
  | { readonly kind: 'account' }
  | { readonly kind: 'sign_out' }
  | { readonly kind: 'method'; readonly provider: AccountProvider }
  | { readonly kind: 'start'; readonly provider: AccountProvider }
  | { readonly kind: 'callback'; readonly provider: AccountProvider }
  | { readonly kind: 'test_authorize' };

export const accountRoute = (pathname: string): AccountRoute | undefined => {
  if (pathname === '/v2/account') return { kind: 'account' };
  if (pathname === '/v2/account/sign-out') return { kind: 'sign_out' };
  if (pathname === '/v2/auth/test/authorize') return { kind: 'test_authorize' };
  const method = /^\/v2\/account\/sign-in-methods\/([a-z]+)$/u.exec(pathname);
  if (method && isAccountProvider(method[1])) {
    return { kind: 'method', provider: method[1] };
  }
  const auth = /^\/v2\/auth\/([a-z]+)\/(start|callback)$/u.exec(pathname);
  if (auth && isAccountProvider(auth[1])) {
    return auth[2] === 'start'
      ? { kind: 'start', provider: auth[1] }
      : { kind: 'callback', provider: auth[1] };
  }
  return undefined;
};

/** One account's object, as the routes use it. */
export interface AccountObject {
  signIn(
    accountId: string,
    identity: SignInIdentity,
    session: NewSession
  ): Promise<SignInOutcome>;
  read(secretHash: string, now: number): Promise<AccountView | null>;
  update(
    secretHash: string,
    now: number,
    change: { readonly name?: string; readonly avatar?: AccountAvatar }
  ): Promise<AccountView | null>;
  signOut(secretHash: string): Promise<void>;
  holds(provider: AccountProvider, subject: string): Promise<boolean>;
  link(
    secretHash: string,
    now: number,
    identity: SignInIdentity
  ): Promise<LinkOutcome>;
  unlink(
    secretHash: string,
    now: number,
    provider: AccountProvider
  ): Promise<UnlinkOutcome>;
  signIns(
    secretHash: string,
    now: number
  ): Promise<{
    readonly accountId: string;
    readonly methods: readonly {
      readonly provider: AccountProvider;
      readonly subject: string;
    }[];
  } | null>;
  erase(secretHash: string, now: number): Promise<boolean>;
}

/** One provider id's record (sign-in-record.ts), as the routes use it. */
export interface SignInRecordObject {
  claim(accountId: string, now: number): Promise<string>;
  release(accountId: string): Promise<void>;
}

export interface AccountHttpDependencies {
  readonly account: (accountId: string) => AccountObject;
  readonly signInRecord: (
    provider: AccountProvider,
    subject: string
  ) => SignInRecordObject;
  readonly configuration: SignInConfiguration;
  readonly fetch: Fetch;
  readonly now: () => number;
  readonly rateLimit: (
    kind: 'sign_in' | 'account'
  ) => Promise<RequestRateLimitDecision>;
}

/** How a sign-in ended, for the table to say so. */
export type SignInResult =
  | 'signed_in'
  | 'linked'
  | 'cancelled'
  | 'expired'
  | 'failed'
  | 'unavailable'
  | 'signed_out'
  | 'already_linked'
  | 'provider_taken'
  | 'rate_limited';

interface SignInAttempt {
  readonly provider: AccountProvider;
  readonly state: string;
  readonly verifier: string;
  readonly intent: 'sign-in' | 'link';
  readonly display: 'popup' | 'page';
  /** Where the table was: its path and query on this origin. */
  readonly returnTo: string;
  readonly startedAt: number;
}

const MAX_RETURN_LENGTH = 2048;
const MAX_ACCOUNT_BODY_BYTES = 1024;

/** A place on this origin to come back to, or the app's page. */
const returnPath = (value: string | null, origin: string): string => {
  if (!value || value.length > MAX_RETURN_LENGTH) return '/';
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}` : '/';
  } catch {
    return '/';
  }
};

const encodeAttempt = (attempt: SignInAttempt): string =>
  base64Url(new TextEncoder().encode(JSON.stringify(attempt)));

const decodeAttempt = (value: string | undefined): SignInAttempt | undefined => {
  const bytes = value === undefined ? undefined : fromBase64Url(value);
  if (!bytes) return undefined;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const read = (key: string): unknown => Reflect.get(Object(parsed), key);
    const provider = read('provider');
    const intent = read('intent');
    const display = read('display');
    const state = read('state');
    const verifier = read('verifier');
    const returnTo = read('returnTo');
    const startedAt = read('startedAt');
    if (
      !isAccountProvider(provider) ||
      (intent !== 'sign-in' && intent !== 'link') ||
      (display !== 'popup' && display !== 'page') ||
      typeof state !== 'string' ||
      typeof verifier !== 'string' ||
      typeof returnTo !== 'string' ||
      typeof startedAt !== 'number'
    ) {
      return undefined;
    }
    return { provider, intent, display, state, verifier, returnTo, startedAt };
  } catch {
    return undefined;
  }
};

const nonce = (): string => newSignInSecret().slice(0, 22);

const htmlHeaders = (scriptNonce: string): Record<string, string> => ({
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${scriptNonce}'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/gu,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] ?? char
  );

/** The channel the finished sign-in tells the table on (account-api.ts). */
export const ACCOUNT_CHANNEL = 'ptcgsim-account';

/**
 * The page a sign-in ends on: it tells the table how it went on a
 * BroadcastChannel (a popup that went through Google may have lost its
 * opener), then closes itself or, opened as a page, goes back to the table.
 */
const finishPage = (
  request: Request,
  result: SignInResult,
  attempt: SignInAttempt | undefined,
  cookies: readonly string[]
): Response => {
  const scriptNonce = nonce();
  const origin = new URL(request.url).origin;
  const back = new URL(attempt?.returnTo ?? '/', origin);
  back.searchParams.set('account', result);
  const message = JSON.stringify({ kind: 'sign-in', result });
  const script = `(() => {
  try { const channel = new BroadcastChannel(${JSON.stringify(ACCOUNT_CHANNEL)}); channel.postMessage(${message}); channel.close(); } catch {}
  if (${JSON.stringify(attempt?.display ?? 'page')} === 'popup' || window.opener) window.close();
  setTimeout(() => location.replace(${JSON.stringify(`${back.pathname}${back.search}`)}), 250);
})();`;
  const headers = new Headers(htmlHeaders(scriptNonce));
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PTCG Sim</title><body style="font:15px system-ui;padding:24px;background:#231b16;color:#f4ede6"><p id="signInResult" data-result="${escapeHtml(result)}">…</p><script nonce="${scriptNonce}">${script}</script></body></html>`,
    { status: 200, headers }
  );
};

const clearSignInCookie = (request: Request): string =>
  setCookie(request, signInCookieName(request), '', 0);

const sessionCookie = (request: Request, token: SessionToken): string =>
  setCookie(
    request,
    sessionCookieName(request),
    formatSessionToken(token),
    ACCOUNT_SESSION_LIFETIME_MS / 1000
  );

const clearSessionCookie = (request: Request): string =>
  setCookie(request, sessionCookieName(request), '', 0);

const tooMany = (decision: RequestRateLimitDecision): Response =>
  json({ error: 'rate_limited' }, 429, {
    'Retry-After': String(decision.retryAfterSeconds),
  });

const startSignIn = async (
  request: Request,
  provider: AccountProvider,
  dependencies: AccountHttpDependencies
): Promise<Response> => {
  const url = new URL(request.url);
  const display = url.searchParams.get('display') === 'page' ? 'page' : 'popup';
  const attempt: SignInAttempt = {
    provider,
    state: newSignInSecret(),
    verifier: newSignInSecret(),
    intent: url.searchParams.get('intent') === 'link' ? 'link' : 'sign-in',
    display,
    returnTo: returnPath(url.searchParams.get('return'), url.origin),
    startedAt: dependencies.now(),
  };
  const decision = await dependencies.rateLimit('sign_in');
  if (!decision.allowed) {
    return finishPage(request, 'rate_limited', attempt, []);
  }
  const destination = authorizeUrl(dependencies.configuration, provider, {
    origin: url.origin,
    state: attempt.state,
    codeChallenge: await pkceChallenge(attempt.verifier),
  });
  if (!destination) return finishPage(request, 'unavailable', attempt, []);
  return new Response(null, {
    status: 302,
    headers: {
      Location: destination,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Set-Cookie': setCookie(
        request,
        signInCookieName(request),
        encodeAttempt(attempt),
        SIGN_IN_ATTEMPT_LIFETIME_MS / 1000
      ),
    },
  });
};

/** Signs in with an identity: the account its record points to, or a new one. */
const signInWith = async (
  identity: SignInIdentity,
  dependencies: AccountHttpDependencies,
  now: number
): Promise<{ token: SessionToken } | undefined> => {
  const record = dependencies.signInRecord(identity.provider, identity.subject);
  let candidate = newAccountId();
  // A record left pointing at an account that gave the id up is released
  // and claimed afresh, once.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const owner = await record.claim(candidate, now);
    const token = newSessionToken(owner);
    const outcome = await dependencies
      .account(owner)
      .signIn(owner, identity, {
        secretHash: await sha256Hex(token.secret),
        now,
      });
    if (outcome.kind === 'signed_in') return { token };
    await record.release(owner);
    candidate = newAccountId();
  }
  return undefined;
};

const linkTo = async (
  request: Request,
  identity: SignInIdentity,
  dependencies: AccountHttpDependencies,
  now: number
): Promise<SignInResult> => {
  const token = readSessionToken(request);
  if (!token) return 'signed_out';
  const secretHash = await sha256Hex(token.secret);
  const account = dependencies.account(token.accountId);
  const view = await account.read(secretHash, now);
  if (!view) return 'signed_out';
  const existing = view.methods.find(
    (method) => method.provider === identity.provider
  );
  if (existing) {
    return (await account.holds(identity.provider, identity.subject))
      ? 'linked'
      : 'provider_taken';
  }
  const record = dependencies.signInRecord(identity.provider, identity.subject);
  let owner = await record.claim(token.accountId, now);
  if (
    owner !== token.accountId &&
    !(await dependencies.account(owner).holds(identity.provider, identity.subject))
  ) {
    await record.release(owner);
    owner = await record.claim(token.accountId, now);
  }
  if (owner !== token.accountId) return 'already_linked';
  const outcome = await account.link(secretHash, now, identity);
  if (outcome.kind === 'linked') return 'linked';
  await record.release(token.accountId);
  return outcome.kind === 'provider_taken' ? 'provider_taken' : 'signed_out';
};

const finishSignIn = async (
  request: Request,
  provider: AccountProvider,
  dependencies: AccountHttpDependencies
): Promise<Response> => {
  const url = new URL(request.url);
  const attempt = decodeAttempt(
    readCookie(request, signInCookieName(request))
  );
  const cookies = [clearSignInCookie(request)];
  const now = dependencies.now();
  const decision = await dependencies.rateLimit('sign_in');
  if (!decision.allowed) {
    return finishPage(request, 'rate_limited', attempt, cookies);
  }
  if (
    !attempt ||
    attempt.provider !== provider ||
    attempt.state !== url.searchParams.get('state') ||
    now - attempt.startedAt > SIGN_IN_ATTEMPT_LIFETIME_MS
  ) {
    return finishPage(request, 'expired', attempt, cookies);
  }
  if (url.searchParams.has('error')) {
    return finishPage(request, 'cancelled', attempt, cookies);
  }
  const code = url.searchParams.get('code');
  if (!code || code.length > 2048) {
    return finishPage(request, 'failed', attempt, cookies);
  }
  let identity: SignInIdentity;
  try {
    identity = await exchangeSignInCode(
      dependencies.configuration,
      provider,
      { origin: url.origin, code, codeVerifier: attempt.verifier, now },
      dependencies.fetch
    );
  } catch {
    return finishPage(request, 'failed', attempt, cookies);
  }
  if (attempt.intent === 'link') {
    return finishPage(
      request,
      await linkTo(request, identity, dependencies, now),
      attempt,
      cookies
    );
  }
  const signedIn = await signInWith(identity, dependencies, now);
  if (!signedIn) return finishPage(request, 'failed', attempt, cookies);
  // Signed in before on this browser? That session ends here.
  const previous = readSessionToken(request);
  if (previous) {
    await dependencies
      .account(previous.accountId)
      .signOut(await sha256Hex(previous.secret));
  }
  return finishPage(request, 'signed_in', attempt, [
    ...cookies,
    sessionCookie(request, signedIn.token),
  ]);
};

/** The stand-in provider's page: a name, Continue or Cancel. */
const testAuthorizePage = (
  request: Request,
  dependencies: AccountHttpDependencies
): Response => {
  if (!dependencies.configuration.test) {
    return json({ error: 'not_found' }, 404);
  }
  const state = new URL(request.url).searchParams.get('state') ?? '';
  const scriptNonce = nonce();
  const value = escapeHtml(state.slice(0, 64));
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Test sign-in</title><body style="font:15px system-ui;padding:24px"><form method="get" action="/v2/auth/test/callback"><input type="hidden" name="state" value="${value}"><label>Name <input id="testSignInName" name="code" value="Tester" maxlength="32"></label> <button id="testSignInContinue" type="submit">Continue</button> <a id="testSignInCancel" href="/v2/auth/test/callback?state=${value}&amp;error=access_denied">Cancel</a></form></body></html>`,
    { status: 200, headers: htmlHeaders(scriptNonce) }
  );
};

/** What the table is told of an account. */
const accountBody = (view: AccountView) => ({
  id: view.id,
  name: view.name,
  avatar: view.avatar,
  createdAt: view.createdAt,
  methods: view.methods,
  sessionProvider: view.sessionProvider,
});

const signedInAccount = async (
  request: Request,
  dependencies: AccountHttpDependencies
): Promise<
  | {
      readonly token: SessionToken;
      readonly secretHash: string;
      readonly account: AccountObject;
    }
  | undefined
> => {
  const token = readSessionToken(request);
  if (!token) return undefined;
  return {
    token,
    secretHash: await sha256Hex(token.secret),
    account: dependencies.account(token.accountId),
  };
};

const signedOut = (request: Request): Response =>
  json({ error: 'signed_out' }, 401, {
    'Set-Cookie': clearSessionCookie(request),
  });

const readAccount = async (
  request: Request,
  dependencies: AccountHttpDependencies
): Promise<Response> => {
  const providers = availableProviders(dependencies.configuration);
  const session = await signedInAccount(request, dependencies);
  if (!session) return json({ providers, account: null }, 200);
  const view = await session.account.read(
    session.secretHash,
    dependencies.now()
  );
  return view
    ? json({ providers, account: accountBody(view) }, 200)
    : json({ providers, account: null }, 200, {
        'Set-Cookie': clearSessionCookie(request),
      });
};

const readAccountBody = async (
  request: Request
): Promise<Record<string, unknown> | undefined> => {
  if (!isIdentityJsonRequest(request)) return undefined;
  try {
    const body = await readBoundedJsonRequest(request, MAX_ACCOUNT_BODY_BYTES);
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const updateAccount = async (
  request: Request,
  dependencies: AccountHttpDependencies
): Promise<Response> => {
  const body = await readAccountBody(request);
  if (!body) return json({ error: 'invalid_request' }, 400);
  const name = body['name'] === undefined ? undefined : accountName(body['name']);
  const avatar = body['avatar'];
  if (
    (body['name'] !== undefined && name === undefined) ||
    (avatar !== undefined && !isAccountAvatar(avatar)) ||
    Object.keys(body).some((key) => key !== 'name' && key !== 'avatar')
  ) {
    return json({ error: 'invalid_request' }, 400);
  }
  const session = await signedInAccount(request, dependencies);
  if (!session) return signedOut(request);
  const view = await session.account.update(
    session.secretHash,
    dependencies.now(),
    {
      ...(name === undefined ? {} : { name }),
      ...(avatar === undefined ? {} : { avatar }),
    }
  );
  return view ? json({ account: accountBody(view) }, 200) : signedOut(request);
};

const signOut = async (
  request: Request,
  dependencies: AccountHttpDependencies
): Promise<Response> => {
  const session = await signedInAccount(request, dependencies);
  if (session) await session.account.signOut(session.secretHash);
  return browserNoContentResponse({
    'Set-Cookie': clearSessionCookie(request),
  });
};

const removeMethod = async (
  request: Request,
  provider: AccountProvider,
  dependencies: AccountHttpDependencies
): Promise<Response> => {
  const session = await signedInAccount(request, dependencies);
  if (!session) return signedOut(request);
  const now = dependencies.now();
  const outcome = await session.account.unlink(
    session.secretHash,
    now,
    provider
  );
  switch (outcome.kind) {
    case 'signed_out':
      return signedOut(request);
    case 'missing':
      return json({ error: 'missing' }, 404);
    case 'last_method':
      return json({ error: 'last_method' }, 409);
    case 'removed': {
      await dependencies
        .signInRecord(provider, outcome.subject)
        .release(session.token.accountId);
      const view = await session.account.read(session.secretHash, now);
      return view ? json({ account: accountBody(view) }, 200) : signedOut(request);
    }
  }
};

const deleteAccount = async (
  request: Request,
  dependencies: AccountHttpDependencies
): Promise<Response> => {
  const body = await readAccountBody(request);
  if (!body || typeof body['expectedAccountId'] !== 'string') {
    return json({ error: 'invalid_request' }, 400);
  }
  const session = await signedInAccount(request, dependencies);
  if (!session) return signedOut(request);
  // The account on screen must be the one signed in now.
  if (body['expectedAccountId'] !== session.token.accountId) {
    return json({ error: 'account_changed' }, 409);
  }
  const now = dependencies.now();
  const signIns = await session.account.signIns(session.secretHash, now);
  if (!signIns) return signedOut(request);
  // The ids are given up first, so nothing can sign in to a half-deleted
  // account; a failure here leaves it whole, to try again.
  for (const method of signIns.methods) {
    await dependencies
      .signInRecord(method.provider, method.subject)
      .release(signIns.accountId);
  }
  await session.account.erase(session.secretHash, now);
  return browserNoContentResponse({
    'Set-Cookie': clearSessionCookie(request),
  });
};

export const handleAccountRequest = async (
  request: Request,
  route: AccountRoute,
  dependencies: AccountHttpDependencies
): Promise<Response> => {
  switch (route.kind) {
    case 'start':
      return request.method === 'GET'
        ? startSignIn(request, route.provider, dependencies)
        : json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    case 'callback':
      return request.method === 'GET'
        ? finishSignIn(request, route.provider, dependencies)
        : json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    case 'test_authorize':
      return request.method === 'GET'
        ? testAuthorizePage(request, dependencies)
        : json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    case 'account': {
      if (request.method === 'GET') {
        // Never read from another site: a cross-site request is refused
        // whether or not the browser sends its cookie.
        if (request.headers.get('Sec-Fetch-Site') === 'cross-site') {
          return json({ error: 'forbidden' }, 403);
        }
        // A read with a session asks its account's object: counted, so
        // made-up cookies can't spend the plan's requests.
        if (readSessionToken(request)) {
          const decision = await dependencies.rateLimit('account');
          if (!decision.allowed) return tooMany(decision);
        }
        return readAccount(request, dependencies);
      }
      if (request.method !== 'PATCH' && request.method !== 'DELETE') {
        return json({ error: 'method_not_allowed' }, 405, {
          Allow: 'GET, PATCH, DELETE',
        });
      }
      break;
    }
    case 'sign_out':
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
      }
      break;
    case 'method':
      if (request.method !== 'DELETE') {
        return json({ error: 'method_not_allowed' }, 405, { Allow: 'DELETE' });
      }
      break;
  }
  if (!isSameOriginBrowserRequest(request)) {
    return json({ error: 'forbidden' }, 403);
  }
  const decision = await dependencies.rateLimit('account');
  if (!decision.allowed) return tooMany(decision);
  switch (route.kind) {
    case 'account':
      return request.method === 'PATCH'
        ? updateAccount(request, dependencies)
        : deleteAccount(request, dependencies);
    case 'sign_out':
      return signOut(request, dependencies);
    case 'method':
      return removeMethod(request, route.provider, dependencies);
  }
};
