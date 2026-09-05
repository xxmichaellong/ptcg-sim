import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const rendererCacheFixturePrefix = '/__ptcgsim-test-assets__/renderer-cache-v1';
const rendererCacheFixtureCount = 120;

const rendererCacheFixtureBody = (index: number): string => {
  const id = String(index).padStart(3, '0');
  const hue = index * 3;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88" viewBox="0 0 63 88" data-index="${id}"><rect width="63" height="88" fill="hsl(${hue} 70% 45%)"/><circle cx="31.5" cy="36" r="${10 + (index % 9)}" fill="hsl(${(hue + 120) % 360} 80% 75%)"/><path d="M8 72h${12 + (index % 35)}v6H8z" fill="hsl(${(hue + 240) % 360} 65% 20%)"/></svg>`;
};

const rendererCacheFixture = (): Plugin => {
  const requestCounts = Array.from(
    { length: rendererCacheFixtureCount },
    () => 0
  );
  let completedAssetResponses = 0;
  let abortedAssetResponses = 0;
  let conditionalAssetRequests = 0;
  let unexpectedRequests = 0;

  const reset = () => {
    requestCounts.fill(0);
    completedAssetResponses = 0;
    abortedAssetResponses = 0;
    conditionalAssetRequests = 0;
    unexpectedRequests = 0;
  };

  return {
    name: 'ptcgsim-renderer-cache-fixture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = new URL(
          request.url ?? '/',
          'http://ptcgsim.invalid'
        );
        if (!requestUrl.pathname.startsWith(rendererCacheFixturePrefix)) {
          next();
          return;
        }

        const sendJson = (value: unknown) => {
          const body = JSON.stringify(value);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Content-Length', String(body.length));
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          response.end(body);
        };
        if (
          requestUrl.pathname === `${rendererCacheFixturePrefix}/reset` &&
          requestUrl.search === '' &&
          request.method === 'POST'
        ) {
          reset();
          sendJson({ reset: true });
          return;
        }
        if (
          requestUrl.pathname === `${rendererCacheFixturePrefix}/stats` &&
          requestUrl.search === '' &&
          request.method === 'GET'
        ) {
          sendJson({
            fixtureVersion: 1,
            totalAssetRequests: requestCounts.reduce(
              (total, count) => total + count,
              0
            ),
            completedAssetResponses,
            abortedAssetResponses,
            conditionalAssetRequests,
            unexpectedRequests,
            requestCounts,
          });
          return;
        }

        const match = requestUrl.pathname.match(
          new RegExp(`^${rendererCacheFixturePrefix}/card-(\\d{3})\\.svg$`)
        );
        const index = match ? Number(match[1]) : -1;
        if (
          request.method !== 'GET' ||
          requestUrl.search !== '' ||
          !Number.isInteger(index) ||
          index < 0 ||
          index >= rendererCacheFixtureCount
        ) {
          unexpectedRequests += 1;
          response.statusCode = request.method === 'GET' ? 404 : 405;
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          response.end();
          return;
        }

        requestCounts[index] = (requestCounts[index] ?? 0) + 1;
        if (
          request.headers['if-none-match'] !== undefined ||
          request.headers['if-modified-since'] !== undefined
        ) {
          conditionalAssetRequests += 1;
        }
        const body = rendererCacheFixtureBody(index);
        const etag = `"ptcgsim-renderer-cache-v1-${String(index).padStart(3, '0')}"`;
        response.once('finish', () => {
          completedAssetResponses += 1;
        });
        response.once('close', () => {
          if (!response.writableFinished) abortedAssetResponses += 1;
        });
        response.statusCode = 200;
        response.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        response.setHeader('Content-Length', String(body.length));
        response.setHeader(
          'Cache-Control',
          'public, max-age=31536000, immutable'
        );
        response.setHeader('ETag', etag);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        response.end(body);
      });
    },
  };
};

/**
 * Where `wrangler dev` is listening. The dev server proxies `/v2` there so the
 * browser sees one origin: the authority rejects any room-creation, ticket, or
 * socket request whose `Origin` does not match its own request URL, so the
 * proxy must forward the original `Host` (`changeOrigin: false`) rather than
 * rewriting it to the worker's address.
 */
const v2ServerTarget =
  process.env['PTCGSIM_V2_SERVER_ORIGIN'] ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [rendererCacheFixture(), react()],
  server: {
    proxy: {
      // Scoped to the authority's own routes. A blanket `/v2` rule would also
      // swallow `/v2/assets/*`, which this app serves from `public/` and which
      // the worker references, but does not serve, as the default card back.
      '^/v2/(health|rooms)(/.*)?$': {
        target: v2ServerTarget,
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    // Retain maps for the provenance gate without advertising them in shipped
    // modules. `public/.assetsignore` keeps the files out of Wrangler's static
    // asset manifest while leaving them available to local/CI verification.
    sourcemap: 'hidden',
    target: 'es2022',
  },
});
