/**
 * The account routes (ADR-052, apps/server/src/accounts/account-http.ts),
 * as the app calls them. The session is an HttpOnly cookie the browser
 * sends by itself; nothing here ever sees it.
 */

export const ACCOUNT_PROVIDERS = ['google', 'discord', 'test'] as const;
export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number];

export interface AccountMethod {
  readonly provider: AccountProvider;
  /** An email address or a username, as the provider knows the person. */
  readonly label: string;
  readonly linkedAt: number;
}

export interface Account {
  readonly id: string;
  readonly name: string;
  /** `initials`, or `emblem:<card-back emblem>`. */
  readonly avatar: string;
  readonly createdAt: number;
  readonly methods: readonly AccountMethod[];
  /** The method this browser signed in with. */
  readonly sessionProvider: AccountProvider;
}

export interface AccountAnswer {
  readonly providers: readonly AccountProvider[];
  readonly account: Account | null;
}

/** The channel a finished sign-in tells every tab on. */
export const ACCOUNT_CHANNEL = 'ptcgsim-account';

/** How a sign-in ended (the server's SignInResult). */
export const SIGN_IN_RESULTS = [
  'signed_in',
  'linked',
  'cancelled',
  'expired',
  'failed',
  'unavailable',
  'signed_out',
  'already_linked',
  'provider_taken',
  'rate_limited',
] as const;
export type SignInResult = (typeof SIGN_IN_RESULTS)[number];

export const isSignInResult = (value: unknown): value is SignInResult =>
  (SIGN_IN_RESULTS as readonly unknown[]).includes(value);

export class AccountRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(`account request failed: ${String(status)} ${code}`);
    this.name = 'AccountRequestError';
  }
}

const isProvider = (value: unknown): value is AccountProvider =>
  (ACCOUNT_PROVIDERS as readonly unknown[]).includes(value);

const readMethod = (value: unknown): AccountMethod | undefined => {
  const provider: unknown = Reflect.get(Object(value), 'provider');
  const label: unknown = Reflect.get(Object(value), 'label');
  const linkedAt: unknown = Reflect.get(Object(value), 'linkedAt');
  return isProvider(provider) &&
    typeof label === 'string' &&
    typeof linkedAt === 'number'
    ? { provider, label, linkedAt }
    : undefined;
};

/** An account from the server, checked; undefined if malformed. */
export const readAccountBody = (value: unknown): Account | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const id: unknown = Reflect.get(value, 'id');
  const name: unknown = Reflect.get(value, 'name');
  const avatar: unknown = Reflect.get(value, 'avatar');
  const createdAt: unknown = Reflect.get(value, 'createdAt');
  const sessionProvider: unknown = Reflect.get(value, 'sessionProvider');
  const methods: unknown = Reflect.get(value, 'methods');
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof avatar !== 'string' ||
    typeof createdAt !== 'number' ||
    !isProvider(sessionProvider) ||
    !Array.isArray(methods)
  ) {
    return undefined;
  }
  return {
    id,
    name,
    avatar,
    createdAt,
    sessionProvider,
    methods: methods.flatMap((method) => readMethod(method) ?? []),
  };
};

const errorOf = async (response: Response): Promise<AccountRequestError> => {
  let code = 'failed';
  try {
    const body: unknown = await response.json();
    const error: unknown = Reflect.get(Object(body), 'error');
    if (typeof error === 'string') code = error;
  } catch {
    // An answer without a body says only its status.
  }
  return new AccountRequestError(response.status, code);
};

const send = async (
  path: string,
  method: string,
  body?: unknown
): Promise<Response> => {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await errorOf(response);
  return response;
};

export const fetchAccount = async (): Promise<AccountAnswer> => {
  const response = await send('/v2/account', 'GET');
  const body: unknown = await response.json();
  const providers: unknown = Reflect.get(Object(body), 'providers');
  const account: unknown = Reflect.get(Object(body), 'account');
  return {
    providers: Array.isArray(providers) ? providers.filter(isProvider) : [],
    account: account === null ? null : (readAccountBody(account) ?? null),
  };
};

const accountFrom = async (response: Response): Promise<Account> => {
  const body: unknown = await response.json();
  const account = readAccountBody(Reflect.get(Object(body), 'account'));
  if (!account) throw new AccountRequestError(response.status, 'malformed');
  return account;
};

export const patchAccount = async (change: {
  readonly name?: string;
  readonly avatar?: string;
}): Promise<Account> => accountFrom(await send('/v2/account', 'PATCH', change));

export const postSignOut = async (): Promise<void> => {
  await send('/v2/account/sign-out', 'POST');
};

export const deleteSignInMethod = async (
  provider: AccountProvider
): Promise<Account> =>
  accountFrom(await send(`/v2/account/sign-in-methods/${provider}`, 'DELETE'));

export const deleteAccountRequest = async (
  expectedAccountId: string
): Promise<void> => {
  await send('/v2/account', 'DELETE', { expectedAccountId });
};

/** Where a sign-in starts: in a popup, or as the page itself. */
export const signInStartUrl = (
  provider: AccountProvider,
  intent: 'sign-in' | 'link',
  display: 'popup' | 'page',
  returnTo: string
): string =>
  `/v2/auth/${provider}/start?${new URLSearchParams({
    intent,
    display,
    return: returnTo,
  }).toString()}`;
