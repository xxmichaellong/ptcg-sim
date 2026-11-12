import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { ChartLineUpIcon } from '@phosphor-icons/react/dist/csr/ChartLineUp';
import { GaugeIcon } from '@phosphor-icons/react/dist/csr/Gauge';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { PulseIcon } from '@phosphor-icons/react/dist/csr/Pulse';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import type { StatusResponse, ViewResponse } from '../shared/api.js';
import type { ViewId } from '../shared/queries.js';
import { isRangeDays, isSiteEnvironment, RANGE_DAYS, SITE, SITE_ENVIRONMENTS, type RangeDays, type SiteEnvironment } from '../shared/site.js';
import { ago, dateTime } from './format.js';
import { shapeErrors } from './shape/errors.js';
import { shapeLive } from './shape/live.js';
import { problemsOf, shapeOverview } from './shape/overview.js';
import { shapeUsage } from './shape/usage.js';
import { Segmented } from './ui/parts.js';
import { BudgetView } from './views/BudgetView.js';
import { ErrorsView } from './views/ErrorsView.js';
import { LiveView } from './views/LiveView.js';
import { OverviewView } from './views/OverviewView.js';
import { SetupView } from './views/SetupView.js';

/**
 * PTCG Sim Ops (ADR-054): the site's internal dashboard. The address holds
 * the view, environment and range, so a link opens the same page.
 */

type Tab = ViewId | 'setup';

const TABS: readonly { readonly id: Tab; readonly label: string; readonly Icon: ComponentType<{ size?: number; weight?: 'regular' | 'bold' }> }[] = [
  { id: 'overview', label: 'Overview', Icon: ChartLineUpIcon },
  { id: 'live', label: 'Live', Icon: PulseIcon },
  { id: 'budget', label: 'Budget', Icon: GaugeIcon },
  { id: 'errors', label: 'Errors', Icon: WarningCircleIcon },
  { id: 'setup', label: 'Setup', Icon: GearSixIcon },
];

/** How often an open view asks again (Live often; the rest now and then). */
const REFRESH_MS: Readonly<Record<ViewId, number>> = {
  overview: 5 * 60_000,
  errors: 2 * 60_000,
  budget: 5 * 60_000,
  live: 30_000,
};

interface Place {
  readonly tab: Tab;
  readonly env: SiteEnvironment;
  readonly days: RangeDays;
}

const readPlace = (): Place => {
  const query = new URLSearchParams(window.location.search);
  const tab = query.get('view');
  const env = query.get('env');
  const days = Number(query.get('days'));
  return {
    tab: TABS.some((item) => item.id === tab) ? (tab as Tab) : 'overview',
    env: isSiteEnvironment(env) ? env : 'beta',
    days: isRangeDays(days) ? days : 30,
  };
};

const writePlace = (place: Place, replace = false): void => {
  const query = new URLSearchParams();
  if (place.tab !== 'overview') query.set('view', place.tab);
  if (place.env !== 'beta') query.set('env', place.env);
  if (place.days !== 30) query.set('days', String(place.days));
  const search = query.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ''}`;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
};

interface Loaded {
  readonly key: string;
  readonly response: ViewResponse;
}

const useView = (place: Place) => {
  const view = place.tab === 'setup' ? undefined : place.tab;
  const key = view ? `${view}|${place.env}|${String(place.days)}` : '';
  const [loaded, setLoaded] = useState<Loaded>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    if (!view) return undefined;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(undefined);
    fetch(`/api/view?view=${view}&env=${place.env}&days=${String(place.days)}`, { signal: abort.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${String(response.status)}`);
        }
        return (await response.json()) as ViewResponse;
      })
      .then((response) => setLoaded({ key, response }))
      .catch((reason: unknown) => {
        if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [view, place.env, place.days, key, tick]);
  useEffect(() => {
    if (!view) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_MS[view]);
    const onFocus = () => {
      if (loaded && Date.now() - loaded.response.asOf > REFRESH_MS[view]) refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [view, refresh, loaded]);
  return { loaded: loaded?.key === key ? loaded : undefined, stale: loaded && loaded.key !== key ? loaded : undefined, error, busy, refresh };
};

const useStatus = (): StatusResponse | undefined => {
  const [status, setStatus] = useState<StatusResponse>();
  useEffect(() => {
    fetch('/api/status')
      .then(async (response) => (response.ok ? ((await response.json()) as StatusResponse) : undefined))
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  return status;
};

/** Google sign-in, back to this page after. */
const signInHref = (): string => `/auth/sign-in?return=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;

const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
};

const Body = ({ response, place, now }: { readonly response: ViewResponse; readonly place: Place; readonly now: number }) => {
  const model = useMemo(() => {
    switch (response.view) {
      case 'overview':
        return { view: 'overview' as const, model: shapeOverview(response) };
      case 'live':
        return { view: 'live' as const, model: shapeLive(response) };
      case 'budget':
        return {
          view: 'budget' as const,
          model: shapeUsage({ sources: response.sources, asOf: response.asOf, days: response.days, daily: 'usage', events: ['betaEvents', 'previewEvents'] }),
          problems: problemsOf(response.sources),
        };
      case 'errors':
        return { view: 'errors' as const, model: shapeErrors(response) };
    }
  }, [response]);
  switch (model.view) {
    case 'overview':
      return <OverviewView model={model.model} rangeDays={place.days} />;
    case 'live':
      return <LiveView model={model.model} />;
    case 'budget':
      return <BudgetView model={model.model} rangeDays={place.days} problems={model.problems} />;
    case 'errors':
      return <ErrorsView model={model.model} rangeDays={place.days} now={now} />;
  }
};

export const App = () => {
  const [place, setPlace] = useState(readPlace);
  const status = useStatus();
  const now = useNow();
  const { loaded, stale, error, busy, refresh } = useView(place);
  useEffect(() => {
    const follow = () => setPlace(readPlace());
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);
  useEffect(() => {
    const tab = TABS.find((item) => item.id === place.tab)?.label ?? 'Overview';
    document.title = `${tab} · PTCG Sim Ops`;
  }, [place.tab]);
  const go = (patch: Partial<Place>) => {
    const next = { ...place, ...patch };
    writePlace(next);
    setPlace(next);
  };
  const shown = loaded ?? stale;
  const ranged = place.tab !== 'live' && place.tab !== 'setup';
  const environmental = place.tab !== 'budget' && place.tab !== 'setup';

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__row">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              <PulseIcon size={14} weight="bold" />
            </span>
            PTCG Sim <span className="brand__sub">Ops</span>
          </div>
          <nav className="tabs" role="tablist" aria-label="Views">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="tab"
                aria-selected={place.tab === id}
                onClick={() => go({ tab: id })}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </nav>
          <span className="topbar__spacer" />
          <div className="toolbar">
            {environmental && (
              <Segmented
                label="Environment"
                value={place.env}
                options={SITE_ENVIRONMENTS.map((env) => ({ value: env, label: SITE[env].label }))}
                onChange={(env) => go({ env })}
              />
            )}
            {ranged && (
              <Segmented
                label="Range"
                value={place.days}
                options={RANGE_DAYS.map((days) => ({ value: days, label: `${String(days)} days` }))}
                onChange={(days) => go({ days })}
              />
            )}
            {place.tab !== 'setup' && (
              <button type="button" className="icon-button" onClick={refresh} aria-label="Refresh" disabled={busy}>
                <ArrowClockwiseIcon size={14} />
                {busy ? 'Updating' : 'Refresh'}
              </button>
            )}
          </div>
          {status?.email && (
            <form className="viewer" method="post" action="/auth/sign-out">
              <span className="viewer__email" title={status.email}>
                {status.email}
              </span>
              <button type="submit" className="icon-button">
                <SignOutIcon size={14} />
                Sign out
              </button>
            </form>
          )}
        </div>
      </header>

      {place.tab !== 'setup' && (
        <div className="subhead" aria-live="polite">
          {shown?.response.demo && <span className="badge">Demo data</span>}
          {shown ? (
            <span>
              {SITE[shown.response.env].label}
              {place.tab === 'budget' ? ' and the whole account' : ''} · as of {dateTime(shown.response.asOf)} UTC ({ago(shown.response.asOf, now)})
              {place.tab === 'live' ? ' · updates every 30 s' : ''}
            </span>
          ) : error ? null : (
            <span>Loading…</span>
          )}
          {status && !status.demo && !status.token && (
            <button type="button" className="table-toggle" onClick={() => go({ tab: 'setup' })}>
              No API token: see Setup
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="notice notice--critical" role="alert">
          <span>
            Couldn’t load this view:{' '}
            {error === 'sign_in_required' ? <a href={signInHref()}>sign in again</a> : error === 'access_required' ? 'sign in again' : error}.{' '}
            <button type="button" className="table-toggle" onClick={refresh}>
              Try again
            </button>
          </span>
        </div>
      )}

      <main className={`loading${busy && shown ? ' loading--stale' : ''}`}>
        {place.tab === 'setup' ? (
          <SetupView status={status} />
        ) : shown && shown.response.view === place.tab ? (
          <Body response={shown.response} place={place} now={now} />
        ) : !error ? (
          <div className="skeleton" style={{ height: 420, marginTop: 16 }} aria-hidden="true" />
        ) : null}
      </main>
    </div>
  );
};
