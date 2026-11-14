# PTCG Sim Ops

The site's internal dashboard (ADR-054): who plays, how much, how fast it is, what goes wrong, and how much of the Workers Free plan the account is using. Its views:

- **Overview:**
  - the headline numbers, a 7-day average each against the week before;
  - players and where they come from;
  - games and moves;
  - speed: time to table, Core Web Vitals, the players' round trips, moves by kind and requests by route;
  - reliability;
  - the zone's traffic;
  - deployments.
- **Live:**
  - whether the beta, the preview and v1 are up;
  - today against yesterday by the hour;
  - the free plan's day so far;
  - the latest events.
- **Budget:**
  - each free allowance today and over the range;
  - who used it;
  - what Workers Paid would cost.
- **Errors:**
  - script errors by message;
  - server failures;
  - error responses;
  - refused moves and joins;
  - close codes;
  - rate limits.
- **Setup:** what is configured, and how to set up the rest.

## Running it

```sh
pnpm --filter @ptcgsim/ops dev        # http://localhost:5180, your wrangler login
pnpm --filter @ptcgsim/ops dev:demo   # generated data, no login needed
```

`dev` runs the page and the Worker's own handler under Vite. It reads Cloudflare with your wrangler login, which covers everything the dashboard shows. To read with another login, set a token:

```sh
CLOUDFLARE_API_TOKEN=… pnpm --filter @ptcgsim/ops dev
```

## Deploying

```sh
pnpm --filter @ptcgsim/ops run deploy   # builds the page, deploys ptcgsim-ops
```

A fresh deploy serves nothing but a "not set up" page until it is protected. A person sets the secrets; they are never stored in the repository.

1. **An API token**, read-only. In the Cloudflare dashboard: My Profile → API Tokens → Create Token → Custom token, with these permissions:
   - Account · Account Analytics · Read
   - Account · Workers Scripts · Read
   - Zone · Analytics · Read (zone ptcgsim.online)

   Then:

   ```sh
   pnpm --filter @ptcgsim/ops exec wrangler secret put CLOUDFLARE_API_TOKEN
   ```

2. **Protection**, one of:
   - **Sign in with Google**, for the developers' addresses only. It uses the sim's Google OAuth client.
     1. Set four secrets, pasting each value at the prompt:

        ```sh
        corepack pnpm --filter @ptcgsim/ops exec wrangler secret put GOOGLE_CLIENT_ID
        corepack pnpm --filter @ptcgsim/ops exec wrangler secret put GOOGLE_CLIENT_SECRET
        corepack pnpm --filter @ptcgsim/ops exec wrangler secret put OPS_EMAILS
        corepack pnpm --filter @ptcgsim/ops exec wrangler secret put OPS_SESSION_KEY
        ```

        - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: the sim's Google OAuth client.
        - `OPS_EMAILS`: who may sign in, with commas or spaces between addresses, e.g. `dev@example.com, ops@example.com`. Case doesn't matter. It is a secret so the addresses never land in the repository.
        - `OPS_SESSION_KEY`: 32 random characters or more (`openssl rand -base64 48`). It signs the cookies; changing it signs everyone out.

     2. In Google Cloud → APIs & Services → Credentials → the sim's OAuth client, add this authorized redirect URI: `https://ptcgsim-ops.xx-michael-long.workers.dev/auth/callback`.

     Signing in takes a verified Google address on the list. The session lasts seven days, and every request checks the list again: put `OPS_EMAILS` again without an address and that address is out at once, no deploy needed. Until all four secrets are set, the dashboard shows the "not set up" page, naming the ones still missing.

   - **Cloudflare Access**:
     1. Workers & Pages → ptcgsim-ops → Settings → Domains & Routes → workers.dev → enable Cloudflare Access.
     2. Put the team domain (`<team>.cloudflareaccess.com`) and the application's AUD tag in `wrangler.jsonc` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`).
     3. Deploy. Access then takes the place of Google sign-in.

## How it works

- `src/shared/queries.ts`: every query, by view. The browser names a view, an environment (beta or preview) and a range (7, 30 or 90 days). The Worker builds only these fixed queries from those three checked values.
- `src/worker/`: protection (`access.ts`, and Google sign-in's `/auth/*` in `google.ts`), the API client (`cloudflare.ts`) and the handler (`index.ts`). Each source answers on its own, so one failure never hides the rest. Answers are kept per isolate for 20 seconds to 5 minutes.
- `src/client/shape/`: turns the rows into what each view shows. This runs in the browser, so the Worker stays inside Workers Free's 10 ms of CPU.
- `src/client/charts/`: the charts, written for this page:
  - every chart has a table view;
  - the pointer or the arrow keys read any day;
  - today's partial count is an outlined column, and lines stop at yesterday.
- `src/shared/demo.ts`: generated stand-ins for every source, shaped as Cloudflare returns them. Used by `dev:demo` and the tests.

The events the dashboard reads are written by the site (`apps/server/src/analytics-sink.ts`, `apps/server/src/page-report-http.ts`, `apps/web/src/telemetry/page-report.ts`). Their columns are named in `packages/protocol/src/analytics-layout.ts`.
