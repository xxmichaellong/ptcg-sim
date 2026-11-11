import type { ViewId } from './queries.js';
import type { RangeDays, SiteEnvironment } from './site.js';

/**
 * What the dashboard's Worker answers (ADR-054). `GET /api/view` runs one
 * view's queries and returns each source's rows, or why it has none;
 * `GET /api/status` says what is set up.
 */

export type SourceResult =
  | {
      readonly ok: true;
      /** Analytics Engine's rows. */
      readonly rows?: readonly Record<string, unknown>[];
      /** GraphQL's data, a REST result, or a health check. */
      readonly data?: unknown;
    }
  | {
      readonly ok: false;
      /**
       * `unconfigured`: no token. `unauthorized`: the token can't read it.
       * `failed`: anything else, with Cloudflare's message.
       */
      readonly reason: 'unconfigured' | 'unauthorized' | 'failed';
      readonly message: string;
    };

export interface ViewResponse {
  readonly view: ViewId;
  readonly env: SiteEnvironment;
  readonly days: RangeDays;
  /** When the queries ran, in milliseconds. */
  readonly asOf: number;
  /** Generated stand-in data (OPS_DEMO), not the site's. */
  readonly demo: boolean;
  readonly sources: Readonly<Record<string, SourceResult>>;
}

export interface StatusResponse {
  readonly demo: boolean;
  readonly token: boolean;
  /** How the dashboard is protected: Access, a password, or this machine. */
  readonly protection: 'access' | 'password' | 'local';
  readonly accountId: string;
}

/** A probe's answer (`probe` sources). */
export interface ProbeResult {
  readonly status: number;
  readonly ms: number;
  readonly body: unknown;
  readonly error?: string;
}
