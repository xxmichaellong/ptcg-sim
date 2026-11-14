import type { StatusResponse, ViewResponse } from '../shared/api.js';
import { demoSources } from '../shared/demo.js';
import {
  isViewId,
  viewQueries,
  type ViewId,
  type ViewRequest,
} from '../shared/queries.js';
import { isRangeDays, isSiteEnvironment, SITE } from '../shared/site.js';
import {
  checkAccess,
  protectionOf,
  refusal,
  type ProtectionEnv,
} from './access.js';
import { runSource } from './cloudflare.js';
import {
  handleAuthRequest,
  missingGoogleSecrets,
  readGoogleSignIn,
  sessionEmail,
} from './google.js';

/**
 * The internal dashboard's Worker (ADR-054): its page and a small API over
 * Cloudflare's analytics for the site. Every path is checked (access.ts)
 * before anything is served, but for Google sign-in's own `/auth/*`
 * (google.ts); then `/api/*` answers here and everything else is the
 * page's built files.
 */

export interface OpsEnv extends ProtectionEnv {
  readonly ASSETS?: { readonly fetch: (request: Request) => Promise<Response> };
  /** A read-only API token (secret): Account Analytics, Workers Scripts, Zone Analytics. */
  readonly CLOUDFLARE_API_TOKEN?: string;
  readonly CLOUDFLARE_ACCOUNT_ID: string;
  readonly CLOUDFLARE_ZONE_ID: string;
  /** `on`: generated data instead of Cloudflare's (local development). */
  readonly OPS_DEMO?: string;
  /** Another Cloudflare API base (tests). */
  readonly CLOUDFLARE_API_BASE?: string;
  /** The pause before asking again after a 429, in milliseconds (tests). */
  readonly OPS_RETRY_DELAY_MS?: string;
  /**
   * The preview Worker (a service binding). A Worker can't fetch another
   * workers.dev Worker of its own account, so its health is asked here.
   */
  readonly PREVIEW?: {
    readonly fetch: (request: Request) => Promise<Response>;
  };
}

interface WorkerContext {
  readonly waitUntil: (promise: Promise<unknown>) => void;
}

/** How long a view's answer is reused: Cloudflare's numbers move slowly. */
const VIEW_TTL_MS: Readonly<Record<ViewId, number>> = {
  overview: 120_000,
  errors: 120_000,
  budget: 300_000,
  live: 20_000,
};

/**
 * Answers kept in this isolate, by view and moment. (The Cache API does
 * nothing on workers.dev.) A burst of reloads costs Cloudflare one query.
 */
const answers = new Map<
  string,
  { readonly expires: number; readonly body: string }
>();
const MAX_ANSWERS = 64;

/** Clears the kept answers (tests). */
export const forgetAnswers = (): void => answers.clear();

const API_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
} as const;

/** The page a deploy shows until it is protected; `missing`: secrets' names. */
const notSetUp = (
  missing: readonly string[]
) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ops: not set up</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 16px;color:#e8e6e1;background:#141413}code{background:#2a2a28;padding:1px 5px;border-radius:4px}</style>
<h1>Not set up yet</h1>
<p>This dashboard shows nothing until it is protected. For Sign in with Google, set the secrets <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>OPS_EMAILS</code> and <code>OPS_SESSION_KEY</code> with <code>wrangler secret put</code>. Or put the Worker behind Cloudflare Access and set <code>ACCESS_TEAM_DOMAIN</code> and <code>ACCESS_AUD</code>.</p>
${missing.length > 0 ? `<p>Still missing or too short: ${missing.map((name) => `<code>${name}</code>`).join(', ')}.</p>\n` : ''}<p>See <code>apps/ops/README.md</code>.</p>`;

/** Analytics Engine queries one view keeps in flight at once. */
export const AE_CONCURRENCY = 4;

/** Runs tasks at most `size` at a time, in the order they are given. */
const limit = (size: number) => {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= size)
      await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await task();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
};

export const handleViewRequest = async (
  url: URL,
  env: OpsEnv,
  fetcher: typeof fetch,
  now: number
): Promise<Response> => {
  const view = url.searchParams.get('view');
  const environment = url.searchParams.get('env');
  const days = Number(url.searchParams.get('days'));
  if (!isViewId(view) || !isSiteEnvironment(environment) || !isRangeDays(days))
    return refusal(400, 'invalid_view');
  const ttl = VIEW_TTL_MS[view];
  // The moment the view is as of, held for its time to live.
  const asOf = Math.floor(now / ttl) * ttl;
  const demo = env.OPS_DEMO === 'on';
  const key = `${view}|${environment}|${String(days)}|${String(asOf)}|${String(demo)}`;
  const kept = answers.get(key);
  if (kept && kept.expires > now)
    return new Response(kept.body, { headers: API_HEADERS });
  const request: ViewRequest = { view, env: environment, days, now: asOf };
  let sources: ViewResponse['sources'];
  if (demo) {
    sources = demoSources(request);
  } else {
    const queries = viewQueries(request, {
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      zoneId: env.CLOUDFLARE_ZONE_ID,
    });
    const preview = env.PREVIEW;
    const client = {
      token: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      fetch: fetcher,
      ...(preview
        ? {
            probe: (url: string, init: RequestInit) =>
              url.startsWith(`${SITE.preview.origin}/`)
                ? preview.fetch(new Request(url, init))
                : fetcher(url, init),
          }
        : {}),
      ...(env.CLOUDFLARE_API_BASE ? { base: env.CLOUDFLARE_API_BASE } : {}),
      ...(env.OPS_RETRY_DELAY_MS
        ? { retryDelayMs: Number(env.OPS_RETRY_DELAY_MS) }
        : {}),
    };
    // Analytics Engine's SQL turns away a burst, so at most a few of its
    // queries are in flight at once; the rest go together.
    const events = limit(AE_CONCURRENCY);
    const entries = await Promise.all(
      Object.entries(queries).map(
        async ([name, query]) =>
          [
            name,
            await (query.kind === 'ae'
              ? events(() => runSource(client, query))
              : runSource(client, query)),
          ] as const
      )
    );
    sources = Object.fromEntries(entries);
  }
  const body = JSON.stringify({
    view,
    env: environment,
    days,
    asOf,
    demo,
    sources,
  } satisfies ViewResponse);
  // Only answers that came back whole are kept.
  if (Object.values(sources).every((source) => source.ok)) {
    if (answers.size >= MAX_ANSWERS) {
      const oldest = answers.keys().next().value;
      if (oldest !== undefined) answers.delete(oldest);
    }
    answers.set(key, { expires: asOf + ttl, body });
  }
  return new Response(body, { headers: API_HEADERS });
};

export const handleOpsRequest = async (
  request: Request,
  env: OpsEnv,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  now: number = Date.now()
): Promise<Response> => {
  const url = new URL(request.url);
  const protection = protectionOf(env, url);
  if (protection === 'none' && !url.pathname.startsWith('/api/')) {
    return new Response(notSetUp(missingGoogleSecrets(env)), {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
  const google = protection === 'google' ? readGoogleSignIn(env) : undefined;
  // Signing in comes before being signed in.
  if (google && url.pathname.startsWith('/auth/'))
    return handleAuthRequest(request, google, fetcher, now);
  const refused = await checkAccess(request, env, fetcher, now);
  if (refused) return refused;
  if (url.pathname === '/api/status') {
    if (request.method !== 'GET') return refusal(405, 'method_not_allowed');
    const email = google ? await sessionEmail(request, google, now) : undefined;
    return new Response(
      JSON.stringify({
        demo: env.OPS_DEMO === 'on',
        token: Boolean(env.CLOUDFLARE_API_TOKEN),
        protection: protection === 'none' ? 'local' : protection,
        ...(email ? { email } : {}),
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
      } satisfies StatusResponse),
      { headers: API_HEADERS }
    );
  }
  if (url.pathname === '/api/view') {
    if (request.method !== 'GET') return refusal(405, 'method_not_allowed');
    return handleViewRequest(url, env, fetcher, now);
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'))
    return refusal(404, 'not_found');
  if (!env.ASSETS) return refusal(404, 'not_found');
  return env.ASSETS.fetch(request);
};

export default {
  fetch(
    request: Request,
    env: OpsEnv,
    _context: WorkerContext
  ): Promise<Response> {
    return handleOpsRequest(request, env);
  },
};
