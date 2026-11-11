import type { SourceQuery } from '../shared/queries.js';
import type { SourceResult } from '../shared/api.js';

/**
 * Runs the dashboard's queries against Cloudflare's APIs with one read-only
 * token, and its health checks against the sites. Each source answers on
 * its own: one refused or failed never hides the others' rows.
 */

export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

export interface CloudflareClient {
  readonly token: string | undefined;
  readonly accountId: string;
  readonly fetch: typeof fetch;
  /**
   * How a health check asks a site, if not by `fetch`: a Worker can't fetch
   * another workers.dev Worker of its own account, so the preview is asked
   * through a service binding.
   */
  readonly probe?: (url: string, init: RequestInit) => Promise<Response>;
  /** The Cloudflare API's base, for a test or a local stand-in. */
  readonly base?: string;
  readonly now?: () => number;
}

const failure = (
  reason: Extract<SourceResult, { ok: false }>['reason'],
  message: string
): SourceResult => ({ ok: false, reason, message: message.slice(0, 400) });

const authFailure = (status: number, text: string): SourceResult | undefined =>
  status === 401 || status === 403 || /authentication|authoriz/iu.test(text)
    ? failure(
        'unauthorized',
        'The API token cannot read this. See Setup for the permissions it needs.'
      )
    : undefined;

const numberish = (value: unknown): unknown =>
  typeof value === 'string' && /^-?\d+(?:\.\d+)?$/u.test(value)
    ? Number(value)
    : value;

/** Analytics Engine's JSON with its 64-bit counts turned back into numbers. */
const normalizeRows = (rows: unknown): readonly Record<string, unknown>[] =>
  Array.isArray(rows)
    ? rows.map((row: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, numberish(value)])
        )
      )
    : [];

const runAnalyticsEngine = async (
  client: CloudflareClient,
  sql: string
): Promise<SourceResult> => {
  const response = await client.fetch(
    `${client.base ?? CLOUDFLARE_API}/accounts/${client.accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.token ?? ''}` },
      // JSON is its default format.
      body: sql,
    }
  );
  const text = await response.text();
  if (!response.ok) {
    // A dataset nothing has written to yet is no rows, not a fault.
    if (/unknown table|does not exist|no such table/iu.test(text))
      return { ok: true, rows: [] };
    return (
      authFailure(response.status, text) ??
      failure('failed', text || response.statusText)
    );
  }
  try {
    const body = JSON.parse(text) as { data?: unknown };
    return { ok: true, rows: normalizeRows(body.data) };
  } catch {
    return failure(
      'failed',
      'Analytics Engine answered something other than JSON.'
    );
  }
};

const runGraphql = async (
  client: CloudflareClient,
  query: string,
  variables: Readonly<Record<string, unknown>>
): Promise<SourceResult> => {
  const response = await client.fetch(
    `${client.base ?? CLOUDFLARE_API}/graphql`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.token ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const text = await response.text();
  if (!response.ok)
    return (
      authFailure(response.status, text) ??
      failure('failed', text || response.statusText)
    );
  try {
    const body = JSON.parse(text) as {
      data?: unknown;
      errors?: readonly { message?: string }[] | null;
    };
    if (body.errors?.length) {
      const message = body.errors
        .map((error) => error.message ?? '')
        .join('; ');
      // Only the message says whether it is the token.
      return authFailure(200, message) ?? failure('failed', message);
    }
    return { ok: true, data: body.data ?? null };
  } catch {
    return failure('failed', 'GraphQL answered something other than JSON.');
  }
};

const runRest = async (
  client: CloudflareClient,
  path: string
): Promise<SourceResult> => {
  const response = await client.fetch(
    `${client.base ?? CLOUDFLARE_API}${path}`,
    {
      headers: { Authorization: `Bearer ${client.token ?? ''}` },
    }
  );
  const text = await response.text();
  if (!response.ok)
    return (
      authFailure(response.status, text) ??
      failure('failed', text || response.statusText)
    );
  try {
    const body = JSON.parse(text) as { result?: unknown };
    return { ok: true, data: body.result ?? null };
  } catch {
    return failure('failed', 'The API answered something other than JSON.');
  }
};

/** A site asked for once: up or not, how fast, and what it says of itself. */
const runProbe = async (
  client: CloudflareClient,
  url: string
): Promise<SourceResult> => {
  const now = client.now ?? (() => Date.now());
  const started = now();
  try {
    const response = await (client.probe ?? client.fetch)(url, {
      headers: { 'User-Agent': 'ptcgsim-ops health check' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
    });
    const ms = Math.max(0, now() - started);
    let body: unknown = null;
    if ((response.headers.get('Content-Type') ?? '').includes('json')) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    } else {
      await response.body?.cancel();
    }
    return { ok: true, data: { status: response.status, ms, body } };
  } catch (error) {
    return {
      ok: true,
      data: {
        status: 0,
        ms: Math.max(0, now() - started),
        body: null,
        error: error instanceof Error ? error.name : 'Error',
      },
    };
  }
};

export const runSource = async (
  client: CloudflareClient,
  query: SourceQuery
): Promise<SourceResult> => {
  if (query.kind === 'probe') return runProbe(client, query.url);
  if (!client.token)
    return failure('unconfigured', 'No API token is set. See Setup.');
  try {
    switch (query.kind) {
      case 'ae':
        return await runAnalyticsEngine(client, query.sql);
      case 'graphql':
        return await runGraphql(client, query.query, query.variables);
      case 'rest':
        return await runRest(client, query.path);
    }
  } catch (error) {
    return failure(
      'failed',
      error instanceof Error ? error.message : String(error)
    );
  }
};
