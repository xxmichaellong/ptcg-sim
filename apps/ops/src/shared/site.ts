import {
  ANALYTICS_DATASETS,
  type AnalyticsEnvironment,
} from '@ptcgsim/protocol';

/**
 * What the dashboard watches (ADR-054): the beta and the preview, each a
 * Worker with its own analytics dataset, and v1, which is not on Cloudflare
 * and is only checked for being up.
 */
export type SiteEnvironment = AnalyticsEnvironment;
export const SITE_ENVIRONMENTS: readonly SiteEnvironment[] = [
  'beta',
  'preview',
];

export interface SiteEnvironmentInfo {
  readonly label: string;
  /** The Worker that serves it. */
  readonly script: string;
  readonly dataset: string;
  /** Its address, for the health check and the zone's traffic. */
  readonly origin: string;
  /** The host the zone's traffic is filtered to, if it is on the zone. */
  readonly zoneHost?: string;
}

export const SITE: Readonly<Record<SiteEnvironment, SiteEnvironmentInfo>> = {
  beta: {
    label: 'Beta',
    script: 'ptcgsim-v2',
    dataset: ANALYTICS_DATASETS.beta,
    origin: 'https://beta.ptcgsim.online',
    zoneHost: 'beta.ptcgsim.online',
  },
  preview: {
    label: 'Preview',
    script: 'ptcgsim-v2-preview',
    dataset: ANALYTICS_DATASETS.preview,
    origin: 'https://ptcgsim-v2-preview.xx-michael-long.workers.dev',
  },
};

/** v1, on Linode: only its front page is asked for. */
export const V1_ORIGIN = 'https://ptcgsim.online';

/** Durable Object classes, as the budget names them. */
export const OBJECT_CLASS_LABELS: Readonly<Record<string, string>> = {
  PtcgRoom: 'Rooms',
  PtcgRoomCode: 'Room codes',
  PtcgContinuation: 'Saves',
  PtcgContinuationQuota: 'Save quotas',
  PtcgDeckFeed: 'Deck feed',
  PtcgCardCatalog: 'Card catalog',
  PtcgDeckIndex: 'Deck index',
  PtcgImageStore: 'Card backs',
  PtcgAccount: 'Accounts',
  PtcgSignIn: 'Sign-ins',
};

/** Workers in the account, by the name the budget gives them. */
export const SCRIPT_LABELS: Readonly<Record<string, string>> = {
  'ptcgsim-v2': 'Beta',
  'ptcgsim-v2-preview': 'Preview',
  'ptcgsim-ops': 'This dashboard',
};

export const RANGE_DAYS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];

export const isSiteEnvironment = (value: unknown): value is SiteEnvironment =>
  value === 'beta' || value === 'preview';
export const isRangeDays = (value: unknown): value is RangeDays =>
  value === 7 || value === 30 || value === 90;
