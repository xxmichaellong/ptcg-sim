# Continuation managed-preview runbook

Status: provisioning tooling, local dry-run, and a three-stage persisted
key-rotation/rollback rehearsal are implemented. No Cloudflare preview has been
created and no managed-preview evidence is claimed.

This runbook creates an isolated, explicitly activated Worker for continuation
testing. It never targets `ptcgsim-v2`, never copies routes or domains from the
checked-in configuration, and never stores credentials in a tracked file.
Deployment is an operator action after account, namespace, quota, cost, and
evidence ownership have been approved.

## Why the bundle is private

Run `prepare:continuation-preview` to create five files beneath
`.private/continuation-preview/<rehearsal>/`, which is ignored by Git. The
directory is mode `0700`; every file is mode `0600`:

| File                            | Purpose                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `wrangler.json`                 | Isolated Worker topology with no production route and no activation  |
| `manifest.json`                 | Reviewable non-secret target, quota, key-ID, and namespace inventory |
| `continuation-credentials.json` | AES keyring and quota strings for `wrangler secret bulk`             |
| `continuation-activate.json`    | The one exact activation token                                       |
| `continuation-deactivate.json`  | A JSON `null` deletion for only the activation secret                |

The command never calls Cloudflare and never prints a key, key digest, keyring,
or activation value. It uses Node's cryptographic random source for a new
32-byte AES-256 key, zeroes the temporary byte buffer, and validates the result
with the same pure schema readers used by the Worker. It refuses existing
output, symbolic-link paths, non-private prior credential files, production
Worker names, production namespace overlap, invalid capacity, source topology
drift, duplicate retained keys, and more than four total keys.

Keep the credential bundle in approved encrypted operator storage for the full
continuation retention window. Never attach it to CI artifacts, PRs, issues,
logs, traces, or support tickets. The current maximum continuation retention is
30 days. Key retirement requires that entire window plus verified cleanup.

## Inputs requiring operator approval

Before generating a bundle, record:

- a disposable Worker name matching
  `ptcgsim-v2-continuation-preview[-<lowercase-suffix>]`;
- a build ID matching the commit under test;
- a new bounded key ID that contains no secret information;
- a deliberately small preview shard count and leases-per-shard value;
- four unused, contiguous positive rate-limit namespace IDs in the target
  Cloudflare account; and
- the account/profile, test window, cost owner, evidence owner, and teardown
  owner.

The generator maps `--rate-namespace-base` through base plus three, in this
order: room create, continuation create, continuation restore, continuation
revoke. It proves that those values do not overlap the four IDs in the
checked-in production configuration. It cannot inspect the rest of a
Cloudflare account, so the operator must verify that all four are otherwise
unused. Cloudflare documents that a namespace ID is an account-unique positive
integer and that reuse across Workers deliberately shares counters. See the
[Rate Limiting binding contract](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

The quota product is a hard global lease ceiling. Start with a small rehearsal
value such as four shards and four leases per shard; that example is not a
production capacity decision.

Do not substitute Wrangler's anonymous `deploy --temporary` mode for this
approval. Temporary-account creation requires an operator to accept
Cloudflare's terms and privacy policy, and the documented supported-resource
table does not include this Worker's Rate Limiting bindings. It therefore
cannot establish the approved account, complete topology, cost ownership, or
retention evidence required by this runbook. See Cloudflare's
[temporary deployment contract](https://developers.cloudflare.com/workers/platform/claim-deployments/).

## Generate and inspect without network access

Use task-specific shell variables; do not place credentials in variables or
command arguments:

```sh
export PTCGSIM_PREVIEW_BUNDLE=.private/continuation-preview/rehearsal-YYYYMMDD

corepack pnpm run prepare:continuation-preview -- \
  --output "$PTCGSIM_PREVIEW_BUNDLE" \
  --worker-name ptcgsim-v2-continuation-preview-rehearsal \
  --build-id preview-<commit> \
  --key-id preview-YYYYMMDD-1 \
  --quota-shards 4 \
  --quota-leases-per-shard 4 \
  --rate-namespace-base <approved-unused-base>
```

Inspect only `manifest.json` and `wrangler.json`. Confirm the exact Worker name,
build ID, quota product, four bindings/IDs, Durable Object bindings/exports,
absolute source/asset paths, `workers_dev: true`, and absence of `routes`,
`domains`, `CONTINUATION_HTTP_ACTIVATION`, `CONTINUATION_KEYRING`, and
`CONTINUATION_QUOTA_CONFIGURATION` from `wrangler.json`.

Build and exercise Wrangler's real configuration parser without uploading:

```sh
corepack pnpm --filter @ptcgsim/web run build
corepack pnpm --filter @ptcgsim/server-v2 exec wrangler deploy \
  --dry-run \
  --config "$PTCGSIM_PREVIEW_BUNDLE/wrangler.json"
```

The dry run must list exactly three Durable Object bindings, four distinct rate
limit bindings, and `BUILD_ID`; it must not list any continuation activation,
keyring, or quota variable. This checked-in generator was locally rehearsed
against the pinned Wrangler version. A dry run is not managed evidence.

## Provision in three explicit phases

`wrangler deploy` and `wrangler secret bulk` change remote state. Confirm the
active Wrangler identity and exact target before each phase. Cloudflare states
that `secret bulk` creates and immediately deploys a new Worker version, which
is why activation has its own file and is always last. See the
[Wrangler command contract](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
and [secret deployment guidance](https://developers.cloudflare.com/workers/configuration/secrets/).

### 1. Deploy default-off code

```sh
corepack pnpm --filter @ptcgsim/server-v2 exec wrangler whoami
corepack pnpm --filter @ptcgsim/server-v2 exec wrangler deploy \
  --strict \
  --config "$PTCGSIM_PREVIEW_BUNDLE/wrangler.json" \
  --message "continuation preview default-off <commit>"
```

Record the returned `https://...workers.dev` URL as
`PTCGSIM_MANAGED_PREVIEW_URL`. Verify `GET /v2/health` returns the expected build
and schema versions. Do not proceed if the URL, account, Worker name, bindings,
or build ID differs from the reviewed manifest.

### 2. Provision credentials while routes remain hidden

```sh
corepack pnpm --filter @ptcgsim/server-v2 exec wrangler secret bulk \
  "$PTCGSIM_PREVIEW_BUNDLE/continuation-credentials.json" \
  --config "$PTCGSIM_PREVIEW_BUNDLE/wrangler.json"

corepack pnpm --filter @ptcgsim/server-v2 exec wrangler secret list \
  --config "$PTCGSIM_PREVIEW_BUNDLE/wrangler.json"
```

List secret **names only** and require `CONTINUATION_KEYRING` and
`CONTINUATION_QUOTA_CONFIGURATION`; never echo their values. Then run the
production-topology journey against the managed origin:

```sh
PTCGSIM_PREVIEW_URL="$PTCGSIM_MANAGED_PREVIEW_URL" \
  corepack pnpm run test:preview:browser -- --project=chromium
```

This must prove the ordinary app/room path works while all three exact
continuation routes remain `404`. Stop here on any mismatch.

### 3. Activate and run the one-shot continuation journey

```sh
corepack pnpm --filter @ptcgsim/server-v2 exec wrangler secret bulk \
  "$PTCGSIM_PREVIEW_BUNDLE/continuation-activate.json" \
  --config "$PTCGSIM_PREVIEW_BUNDLE/wrangler.json"

PTCGSIM_CONTINUATION_PREVIEW_URL="$PTCGSIM_MANAGED_PREVIEW_URL" \
  corepack pnpm run test:continuation:browser -- --project=chromium
```

The browser gate must create a real two-player source room, advance authority,
download a strict capability-only save, restore it into a distinct ready room,
admit the rotated opponent through the ordinary foreground invitation, prove
source/target isolation, revoke the completed save, and find neither bearer in
URLs, DOM, location, local storage, or session storage.

Treat Playwright reports, screenshots, traces, and downloads from a managed run
as access-controlled evidence. A failed run can stop after a save is created
but before it is revoked. In that case, do not publish artifacts or blindly
retire the key. Record the failure privately and either complete an authorized
revoke while the routes are active or retain the key and allow alarm cleanup.

## Deactivate and verify

After the journey has confirmed its save was revoked, delete only the
activation secret:

```sh
corepack pnpm --filter @ptcgsim/server-v2 exec wrangler secret bulk \
  "$PTCGSIM_PREVIEW_BUNDLE/continuation-deactivate.json" \
  --config "$PTCGSIM_PREVIEW_BUNDLE/wrangler.json"

PTCGSIM_PREVIEW_URL="$PTCGSIM_MANAGED_PREVIEW_URL" \
  corepack pnpm run test:preview:browser -- --project=chromium
```

The second production-topology run must again observe all continuation routes
as `404`. Deactivation does not delete the keyring, quota configuration, Worker,
or Durable Object namespaces. This is intentional: alarms can finish cleanup,
and a key must remain available for any unexpired record. The current single
activation token cannot pause create/restore while retaining revoke; this
remains a production rollout limitation.

Do not delete the Worker or its Durable Object exports as part of an automatic
script. Remote teardown is a separate, explicitly approved destructive action
after retained records, evidence, cost data, alarms, and rollback observations
have been reconciled.

## Key rotation and rollback crossing

To prepare a new active key while retaining every prior decrypt key, create a
new output directory and pass the previous private credentials file:

```sh
corepack pnpm run prepare:continuation-preview -- \
  --output .private/continuation-preview/rotation-YYYYMMDD \
  --worker-name ptcgsim-v2-continuation-preview-rehearsal \
  --build-id preview-<commit> \
  --key-id preview-YYYYMMDD-2 \
  --quota-shards 4 \
  --quota-leases-per-shard 4 \
  --rate-namespace-base <same-approved-unused-base> \
  --previous-credentials \
    "$PTCGSIM_PREVIEW_BUNDLE/continuation-credentials.json"
```

The new manifest lists only active and retained key IDs. The new credential
file contains the new active encrypt/decrypt key plus every old decrypt key.
Uploading it through `secret bulk` is still a remote deployment and requires a
rotation plan. The generator refuses a fifth key and does not implement
retirement: remove an old key only after every record it can protect has passed
the 30-day maximum retention window and cleanup has been verified.

The dedicated rotation journey carries one capability across deployments in a
private, origin-bound artifact. It never starts a server, so
`PTCGSIM_CONTINUATION_PREVIEW_URL` is mandatory. In-repository artifacts are
allowed only below `.private/continuation-rotation/<stage>/`; their directory is
mode `0700`, their two files are mode `0600`, existing output and symbolic-link
paths are refused, and expired or wrong-origin input fails before browser work.
The runner disables retries, traces, screenshots, video, and HTML reports.

First, while the original key is active and continuation routes are enabled,
capture an old-key save:

```sh
export PTCGSIM_ROTATION_ROOT=.private/continuation-rotation/rehearsal-YYYYMMDD

PTCGSIM_CONTINUATION_PREVIEW_URL="$PTCGSIM_MANAGED_PREVIEW_URL" \
PTCGSIM_CONTINUATION_ROTATION_OUTPUT="$PTCGSIM_ROTATION_ROOT/old-key" \
  corepack pnpm run test:continuation:rotation:browser -- --project=chromium
```

This stage creates a real two-player room, advances authority, and leaves one
live save in the private output. Review the rotated bundle, deploy its code,
upload `continuation-credentials.json`, verify the new active ID and retained
old ID by **name only** from its manifest, and reactivate if the secret update
changed activation state. Then cross the forward rotation:

```sh
PTCGSIM_CONTINUATION_PREVIEW_URL="$PTCGSIM_MANAGED_PREVIEW_URL" \
PTCGSIM_CONTINUATION_ROTATION_INPUT="$PTCGSIM_ROTATION_ROOT/old-key" \
PTCGSIM_CONTINUATION_ROTATION_OUTPUT="$PTCGSIM_ROTATION_ROOT/new-key" \
  corepack pnpm run test:continuation:rotation:browser -- --project=chromium
```

The transition restores and revokes the input, verifies the exact saved
match/revision and ordinary rotated-opponent admission, advances the restored
room, and captures one new save under the currently active key. A passing stage
therefore proves retained-old-key decryption plus current-key encryption.

For an executable rollback rehearsal, deploy the explicitly reviewed prior
compatible Worker build while preserving the rotated keyring, quota policy,
Durable Object exports/bindings, and activation state. Do not bulk-upload the
old credential file and do not make the old key active again: rollback must not
resume creating ciphertext that delays old-key retirement. After confirming
the rolled-back build ID from `/v2/health`, consume the new-key save without
creating another one:

```sh
PTCGSIM_CONTINUATION_PREVIEW_URL="$PTCGSIM_MANAGED_PREVIEW_URL" \
PTCGSIM_CONTINUATION_ROTATION_INPUT="$PTCGSIM_ROTATION_ROOT/new-key" \
  corepack pnpm run test:continuation:rotation:browser -- --project=chromium
```

That final pass proves the rollback build can decrypt, restore, and revoke data
created by the forward build. Redeploy the intended forward build, verify its
health ID, deactivate, and rerun the production-topology `404` gate. Only then
remove the now-revoked local handoff files through the approved private-data
cleanup process. The harness itself never deletes input or changes Cloudflare
state.

An interrupted transition can leave its input restored but not proven revoked,
or its output directory empty/incomplete after a remote save was attempted.
Do not delete or overwrite either artifact and do not blindly rerun. Preserve
the rotated keyring and activation long enough to reconcile the exact private
stage: confirm whether restore/revoke committed, revoke an identified live save
when authorized, or retain all relevant decrypt keys through alarm expiry.

## Evidence record

Attach only redacted facts to the draft PR/release record:

- commit/build ID, Wrangler version, UTC window, account/profile label, Worker
  name, preview region/client location, and test command;
- reviewed quota product and the fact that all rate-limit namespaces were
  distinct, without copying secret configuration;
- default-off, activated journey, and post-deactivation results;
- safe aggregate platform latency, CPU, memory, storage, alarm, and cost facts;
- rotation/rollback/eviction outcomes once separately exercised; and
- teardown owner/status.

Never attach key material, key digests, complete keyring/quota secret files,
capabilities, invitations, resume tokens, request bodies, raw saved games, or
browser traces that contain them.
