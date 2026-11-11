import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The dashboard's own login on this machine: `CLOUDFLARE_API_TOKEN` if set,
 * else wrangler's (refreshed by `wrangler whoami` when it has run out).
 * Wrangler's login reads usage and deployments but not Analytics Engine;
 * those panels say so until a token with Account Analytics Read is set.
 */
const localToken = (): string | undefined => {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const path = join(
    homedir(),
    '.config',
    '.wrangler',
    'config',
    'default.toml'
  );
  const read = () => {
    try {
      const text = readFileSync(path, 'utf8');
      return {
        token: /^oauth_token = "([^"]+)"/mu.exec(text)?.[1],
        expires: Date.parse(
          /^expiration_time = "([^"]+)"/mu.exec(text)?.[1] ?? ''
        ),
      };
    } catch {
      return { token: undefined, expires: 0 };
    }
  };
  let login = read();
  if (login.token && !(login.expires > Date.now() + 60_000)) {
    try {
      execFileSync('npx', ['wrangler', 'whoami'], {
        stdio: 'ignore',
        timeout: 60_000,
      });
    } catch {
      // Not logged in: the panels say so.
    }
    login = read();
  }
  return login.token;
};

/**
 * `/api/*` in development: the Worker's own handler, run in Node with this
 * machine's login, so the page under `vite` talks to the real API.
 */
const opsApi = (): Plugin => ({
  name: 'ptcgsim-ops-api',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith('/api/')) {
        next();
        return;
      }
      try {
        const module = (await server.ssrLoadModule(
          '/src/worker/index.ts'
        )) as typeof import('./src/worker/index.js');
        const url = new URL(
          request.url,
          `http://${request.headers.host ?? 'localhost'}`
        );
        const answer = await module.handleOpsRequest(
          new Request(url, { method: request.method ?? 'GET' }),
          {
            CLOUDFLARE_ACCOUNT_ID: '03570fc689befad62bb5401ddc95e9cd',
            CLOUDFLARE_ZONE_ID: '6b24c117debe2da91e7e3ebf59dd56c1',
            OPS_LOCAL: 'on',
            ...(process.env.OPS_DEMO === 'on'
              ? { OPS_DEMO: 'on' }
              : { CLOUDFLARE_API_TOKEN: localToken() }),
          }
        );
        response.statusCode = answer.status;
        answer.headers.forEach((value, key) => response.setHeader(key, value));
        response.end(Buffer.from(await answer.arrayBuffer()));
      } catch (error) {
        next(error);
      }
    });
  },
});

export default defineConfig({
  plugins: [react(), opsApi()],
  server: { port: Number(process.env.OPS_PORT ?? 5180), strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
