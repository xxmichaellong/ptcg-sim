// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ViewResponse } from '../shared/api.js';
import { demoSources } from '../shared/demo.js';
import { isViewId } from '../shared/queries.js';
import { App } from './App.js';

/** The dashboard's API, answered from the demo data. */
const api = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(String(input), 'http://localhost');
  if (url.pathname === '/api/status')
    return Response.json({ demo: true, token: false, protection: 'local', accountId: 'a' });
  const view = url.searchParams.get('view');
  if (!isViewId(view)) return Response.json({ error: 'invalid_view' }, { status: 400 });
  const env = url.searchParams.get('env') === 'preview' ? 'preview' : 'beta';
  const days = Number(url.searchParams.get('days')) as 7 | 30 | 90;
  const now = Date.parse('2026-11-11T15:30:00Z');
  return Response.json({
    view,
    env,
    days,
    asOf: now,
    demo: true,
    sources: demoSources({ view, env, days, now }),
  } satisfies ViewResponse);
});

let root: Root | undefined;
let host: HTMLElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', api);
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
  api.mockClear();
  window.history.replaceState(null, '', '/');
});

const settle = async () => {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const open = async (search: string) => {
  window.history.replaceState(null, '', `/${search}`);
  root = createRoot(host);
  act(() => root?.render(<App />));
  await settle();
};

const headings = () => [...host.querySelectorAll('h2')].map((heading) => heading.textContent);

describe('App', () => {
  it('opens the Overview with every section, marked as demo data', async () => {
    await open('');
    expect(host.querySelector('.badge')?.textContent).toBe('Demo data');
    expect(headings()).toEqual(['Players', 'Games', 'Speed', 'Reliability', 'Traffic', 'Releases']);
    expect(host.querySelectorAll('.tile')).toHaveLength(6);
    expect(document.title).toBe('Overview · PTCG Sim Ops');
    expect(api).toHaveBeenCalledWith(expect.stringContaining('/api/view?view=overview&env=beta&days=30'), expect.anything());
  });

  it.each([
    ['?view=live', ['Today so far', 'Free plan today']],
    ['?view=budget&days=90', ['Today', 'Each day', 'Who used it', 'On Workers Paid']],
    ['?view=errors&env=preview&days=7', ["On players' pages", 'Over time', 'On the server'].sort()],
  ])('opens %s', async (search, expected) => {
    await open(search);
    expect([...headings()].sort()).toEqual([...expected].sort());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps the place in the address as the controls change', async () => {
    await open('');
    const button = (text: string) =>
      [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === text);
    act(() => button('Preview')?.click());
    await settle();
    act(() => button('7 days')?.click());
    await settle();
    expect(window.location.search).toBe('?env=preview&days=7');
    act(() => button('Errors')?.click());
    await settle();
    expect(window.location.search).toBe('?view=errors&env=preview&days=7');
    expect(headings()).toContain('On the server');
  });

  it('shows Setup without asking for a view', async () => {
    await open('?view=setup');
    expect(host.textContent).toContain('The API token');
    expect(host.textContent).toContain('Who can see it');
    expect(api.mock.calls.every(([input]) => !String(input).includes('/api/view'))).toBe(true);
  });

  it('says so when the view cannot load', async () => {
    api.mockImplementationOnce(async () => Response.json({ demo: false, token: true, protection: 'password', accountId: 'a' }));
    api.mockImplementationOnce(async () => Response.json({ error: 'password_required' }, { status: 401 }));
    await open('');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('sign in again');
  });
});
