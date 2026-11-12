import type { StatusResponse } from '../../shared/api.js';
import { Status } from '../ui/parts.js';

/** What is set up, and how to set up the rest. */
export const SetupView = ({ status }: { readonly status: StatusResponse | undefined }) => (
  <div className="grid" style={{ marginTop: 22 }}>
    <section className="card span-6 setup" aria-label="Status">
      <div className="card__title">Status</div>
      <table className="table" style={{ marginTop: 10 }}>
        <tbody>
          <tr>
            <td className="left">Data</td>
            <td>
              {status?.demo ? (
                <Status rating="fair" text="Demo data" />
              ) : status?.token ? (
                <Status rating="good" text="API token set" />
              ) : (
                <Status rating="poor" text="No API token" />
              )}
            </td>
          </tr>
          <tr>
            <td className="left">Protection</td>
            <td>
              {status?.protection === 'access' ? (
                <Status rating="good" text="Cloudflare Access" />
              ) : status?.protection === 'google' ? (
                <Status rating="good" text="Google sign-in" />
              ) : (
                <Status rating="fair" text="This machine only" />
              )}
            </td>
          </tr>
          <tr>
            <td className="left">Account</td>
            <td>
              <code>{status?.accountId ?? '—'}</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="card__foot">
        The site itself sends its reports to Workers Analytics Engine (ADR-054); nothing here changes the site. Everything is free on the account’s plan.
      </p>
    </section>
    <section className="card span-6 setup" aria-label="API token">
      <div className="card__title">The API token</div>
      <p className="card__sub">One read-only token reads everything the dashboard shows.</p>
      <ol>
        <li>
          Cloudflare dashboard → My Profile → API Tokens → Create Token → <b>Custom token</b>.
        </li>
        <li>
          Permissions: <code>Account · Account Analytics · Read</code>, <code>Account · Workers Scripts · Read</code>,{' '}
          <code>Zone · Analytics · Read</code>.
        </li>
        <li>Account resources: this account. Zone resources: ptcgsim.online.</li>
        <li>
          Set it on the Worker: <code>pnpm --filter @ptcgsim/ops exec wrangler secret put CLOUDFLARE_API_TOKEN</code>, and paste
          it at the prompt. On this machine, <code>CLOUDFLARE_API_TOKEN=… pnpm --filter @ptcgsim/ops dev</code> uses it instead of
          your wrangler login.
        </li>
      </ol>
    </section>
    <section className="card span-12 setup" aria-label="Protection">
      <div className="card__title">Who can see it</div>
      <p className="card__sub">The deployed dashboard serves nothing until one of these is set.</p>
      <ol>
        <li>
          <b>Sign in with Google</b>, for the addresses on a list. Set four secrets with{' '}
          <code>pnpm --filter @ptcgsim/ops exec wrangler secret put NAME</code>: <code>GOOGLE_CLIENT_ID</code> and{' '}
          <code>GOOGLE_CLIENT_SECRET</code> (the sim’s Google OAuth client), <code>OPS_EMAILS</code> (the addresses, commas or
          spaces between them) and <code>OPS_SESSION_KEY</code> (32 random characters or more). Add{' '}
          <code>https://ptcgsim-ops.xx-michael-long.workers.dev/auth/callback</code> to the client’s authorized redirect URIs.
          Changing <code>OPS_EMAILS</code> takes effect at once.
        </li>
        <li>
          <b>Cloudflare Access</b>: Workers &amp; Pages → ptcgsim-ops → Settings → Domains &amp; Routes → workers.dev → enable
          Cloudflare Access. Then set <code>ACCESS_TEAM_DOMAIN</code> (your <code>&lt;team&gt;.cloudflareaccess.com</code>) and{' '}
          <code>ACCESS_AUD</code> (the application’s audience tag) in <code>apps/ops/wrangler.jsonc</code> and deploy. Access then
          takes the place of Google sign-in.
        </li>
      </ol>
    </section>
  </div>
);
