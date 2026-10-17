import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

export const LEGACY_RUNTIME_ORIGIN = 'http://ptcgsim-legacy-runtime.test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.html': 'text/html',
  '.json': 'application/json',
};

export interface LoadedLegacyRuntime {
  /** Same-origin paths that were actually served. */
  readonly servedPaths: readonly string[];
  /** External origins the fixture refused, proving nothing left the harness. */
  readonly blockedOrigins: readonly string[];
  /** Same-origin paths with no checked-in file behind them. */
  readonly missingPaths: readonly string[];
}

/**
 * Loads the real, checked-in v1 client and lets its own module graph run.
 *
 * The other legacy fixtures stub `front-end.js` and re-implement its behaviour
 * in TypeScript, which makes them a transcription of the source rather than a
 * measurement of it. This loads the actual modules instead, so a comparison
 * against them is evidence about v1 rather than about the transcription.
 *
 * Two accommodations, neither of which touches board geometry:
 *
 * - `io` is stubbed before any module evaluates. `global-variables.js` dials an
 *   external Socket.IO host at import time; the harness must never reach the
 *   network, and multiplayer relay is not what these gates measure.
 * - The EJS import-data token is emptied, exactly as the existing fixture does.
 *
 * Everything else is served verbatim from `client/`, and every other origin is
 * refused so an accidental network dependency fails loudly.
 */
export const loadLegacyRuntime = async (
  page: Page
): Promise<LoadedLegacyRuntime> => {
  const servedPaths = new Set<string>();
  const blockedOrigins = new Set<string>();
  const missingPaths = new Set<string>();

  await page.addInitScript(() => {
    const noop = () => undefined;
    (globalThis as Record<string, unknown>)['io'] = () => ({
      on: noop,
      once: noop,
      off: noop,
      emit: noop,
      connect: noop,
      disconnect: noop,
      id: 'legacy-runtime-stub',
      connected: false,
    });
  });

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== LEGACY_RUNTIME_ORIGIN) {
      blockedOrigins.add(url.origin);
      await route.abort('blockedbyclient');
      return;
    }
    const file =
      url.pathname === '/' ? 'client/index.ejs' : `client${url.pathname}`;
    let body: Buffer;
    try {
      body = await readFile(`${repositoryRoot}${file}`);
    } catch {
      missingPaths.add(url.pathname);
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname === '/') {
      const token = '<%= importDataJSON %>';
      const rendered = body.toString('utf8');
      if (
        rendered.indexOf(token) < 0 ||
        rendered.indexOf(token) !== rendered.lastIndexOf(token)
      ) {
        throw new Error('Legacy index must contain one import-data EJS token');
      }
      body = Buffer.from(rendered.replace(token, ''), 'utf8');
    }
    servedPaths.add(url.pathname);
    await route.fulfill({
      status: 200,
      contentType:
        url.pathname === '/'
          ? 'text/html'
          : (CONTENT_TYPES[extname(file)] ?? 'application/octet-stream'),
      body,
    });
  });

  await page.goto(`${LEGACY_RUNTIME_ORIGIN}/`, { waitUntil: 'load' });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('iframe')].every(
      (frame) =>
        frame.contentDocument?.readyState === 'complete' &&
        frame.contentDocument.getElementById('hand') !== null
    )
  );
  // The entry module's own initialisation must have completed, not merely the
  // document load, or a later import would race it.
  await page.waitForFunction(async () => {
    const specifier = '/src/front-end.js';
    const frontEnd = (await import(/* @vite-ignore */ specifier)) as {
      readonly systemState?: unknown;
    };
    return typeof frontEnd.systemState === 'object';
  });

  return {
    // Keep these live. Tests intentionally perform additional real-runtime
    // operations after initial module loading and must observe any routes those
    // operations request rather than a premature snapshot.
    get servedPaths() {
      return [...servedPaths].sort();
    },
    get blockedOrigins() {
      return [...blockedOrigins].sort();
    },
    get missingPaths() {
      return [...missingPaths].sort();
    },
  };
};
