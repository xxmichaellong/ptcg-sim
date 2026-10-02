# Performance release evidence

This is the release record required by
[ADR-015](./ADR-015-REFERENCE-PERFORMANCE-PROFILE.md). A blank or partially
completed record is `PENDING`; it is not evidence that a budget passed.

## Candidate identity

| Field                            | Recorded value                  |
| -------------------------------- | ------------------------------- |
| UTC date and run window          |                                 |
| Commit and build ID              |                                 |
| V1 baseline tag/build            |                                 |
| Fixture and asset digest         |                                 |
| Operator and reviewer            |                                 |
| Result                           | `PENDING`, `PASS`, or `BLOCKED` |
| Linked raw artifacts and digests |                                 |

## Physical client

| Field                                        | Recorded value        |
| -------------------------------------------- | --------------------- |
| Manufacturer and exact model                 |                       |
| CPU model; physical/logical cores available  |                       |
| Installed/available memory                   |                       |
| Integrated GPU and driver                    |                       |
| Confirmation that no discrete GPU was active |                       |
| OS edition/version/build                     |                       |
| Chrome product/version and executable        |                       |
| Display resolution/scaling                   |                       |
| AC power and power mode                      |                       |
| Thermal/cooling observations                 |                       |
| Browser profile/extensions/DevTools          | Clean / none / closed |

A device outside ADR-015's four-physical-core, 8-GiB, integrated-GPU class is
diagnostic unless an ADR amendment approves a replacement. A headless run or a
GPU renderer containing `SwiftShader`, `llvmpipe`, `software rasterizer`, or a
basic render driver cannot pass.

## Renderer preflight

Run:

```sh
corepack pnpm run measure:v2:renderer
```

This produces a JSON report, HTML report, and per-test attachments under the
gitignored `artifacts/performance/` directory. Preserve all three repetitions
for both projects.

| Project                | Repetition 1 | Repetition 2 | Repetition 3 | Valid physical GPU | Result |
| ---------------------- | ------------ | ------------ | ------------ | ------------------ | ------ |
| Chrome 1366×768/DPR 1  |              |              |              |                    |        |
| Chrome 1920×1080/DPR 2 |              |              |              |                    |        |

The synthetic renderer preflight is necessary but not sufficient. Record the
remaining representative real-raster and protected-workflow results below.

## Renderer and resource budgets

Enter p95 unless the row names another statistic. Each repetition must meet the
absolute budget.

| Metric                               |                       Budget | Run 1 | Run 2 | Run 3 | Result/artifact |
| ------------------------------------ | ---------------------------: | ----: | ----: | ----: | --------------- |
| One-card render-model reconciliation |                   ≤ 4 ms CPU |       |       |       |                 |
| Full 120-card scene reconciliation   |                  ≤ 50 ms CPU |       |       |       |                 |
| Drag frame time                      | p95 ≤ 16.7 ms; p99 ≤ 33.3 ms |       |       |       |                 |
| Input to changed drag visual         |                      ≤ 25 ms |       |       |       |                 |
| Warmed action main-thread long task  |                 none > 50 ms |       |       |       |                 |
| Resize/split coalescing              | ≤ 1 reconciliation per frame |       |       |       |                 |
| Settled idle scheduling              |          0 continuous frames |       |       |       |                 |
| Board-tier estimated GPU textures    |                    ≤ 128 MiB |       |       |       |                 |
| Preview-tier estimated GPU textures  |                     ≤ 16 MiB |       |       |       |                 |
| Initial route JavaScript             |               ≤ 500 KiB gzip |       |       |       |                 |
| Churn resource counts                |    return to warmed baseline |       |       |       |                 |
| Post-collection retained heap        |      ≤ 1.10× warmed baseline |       |       |       |                 |
| Renderer/context recovery            |                  ≤ 3 seconds |       |       |       |                 |

## Paired v1/v2 workflows

Fix the measurement marks before collecting results. The median paired p95 ratio
must be ≤ 1.05, no individual ratio may exceed 1.10, and at least one named
legacy bottleneck must improve by at least 20%.

| Protected workflow        | V1 p95 runs | V2 p95 runs | Ratios | Median ratio | Named bottleneck improvement | Result/artifact |
| ------------------------- | ----------- | ----------- | ------ | -----------: | ---------------------------: | --------------- |
| Setup/reset               |             |             |        |              |                              |                 |
| Single-card action        |             |             |        |              |                              |                 |
| Full-zone open/sort/close |             |             |        |              |                              |                 |
| Drag/drop                 |             |             |        |              |                              |                 |
| Resize/split              |             |             |        |              |                              |                 |
| Reconnect to usable board |             |             |        |              |                              |                 |

## Managed-preview network calibration

| Field                                   | Standard profile      | Recovery-stress profile |
| --------------------------------------- | --------------------- | ----------------------- |
| Preview deployment/build                |                       |                         |
| Client location                         |                       |                         |
| Cloudflare colo/region evidence         |                       |                         |
| Whole-process shaping tool/version      |                       |                         |
| Actual shaper settings/added delay      |                       |                         |
| Downstream/upstream                     | 10/2 Mbit/s           | 5/1 Mbit/s              |
| Target RTT/jitter/loss                  | 50 ms / ≤10 ms / 0.1% | 120 ms / ≤20 ms / 1%    |
| 20 uncached health RTT samples/artifact |                       |                         |
| Median calibration RTT                  | must be 40–60 ms      | recorded, non-gating    |

The shaper must cover HTTP and WebSocket traffic. Browser-only request throttles
that omit WebSocket frames do not qualify.

## Network, recovery, and durability results

| Metric                                      |        Standard-profile budget | Run 1 | Run 2 | Run 3 | Stress result    | Result/artifact |
| ------------------------------------------- | -----------------------------: | ----: | ----: | ----: | ---------------- | --------------- |
| Local intent to immediate feedback          |                    p95 ≤ 50 ms |       |       |       |                  |                 |
| Command to authoritative reconciliation     |     p95 < 250 ms; p99 < 500 ms |       |       |       | correctness only |                 |
| Reconnect after transport becomes available |                      p95 < 2 s |       |       |       | bounded/recorded |                 |
| Duplicate command effects                   |                    exactly one |       |       |       | exactly one      |                 |
| Periodic full-log transmission              |                           zero |       |       |       | zero             |                 |
| Accepted-command durability                 | 100% in injected restart suite |       |       |       | 100%             |                 |

Attach the local `pnpm run measure:v2:server` artifact as diagnostic phase and
payload evidence, but do not copy its local wall-clock values into the managed-
preview result columns.

## Run validity and disposition

- All three repetitions and raw samples are retained; no unfavorable valid run
  was discarded.
- Any discarded run has a cause recorded before its metric values were reviewed.
- Fixture, image, font, build, browser, viewport, power, and network conditions
  were unchanged across paired v1/v2 measurements.
- No runtime, console, renderer-resource, privacy, authority, or persistence
  failure occurred.
- Every exception links to an approved ADR amendment; an unexplained miss is
  `BLOCKED`, not `PASS WITH EXCEPTIONS`.

## Sign-off

| Owner                | Name/date/result |
| -------------------- | ---------------- |
| Renderer/performance |                  |
| Authority/operations |                  |
| Parity               |                  |
| Release/product      |                  |
