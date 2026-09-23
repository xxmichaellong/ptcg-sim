# ADR-015: use a lower-end physical laptop and controlled same-region network profile

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Scope: first v2 release performance environment, statistics, and evidence

## Context

The renderer, network, recovery, memory, and resource budgets in the verification
plan are useful only when their environment and pass rule are fixed. Wall-clock
numbers from a GitHub runner, a developer workstation, SwiftShader, local
`workerd`, or an unspecified Internet connection are valuable regression
signals, but they are not portable release claims.

The project owner approved a vendor-neutral ordinary-laptop target rather than a
premium machine. No exact owned device or player geography was supplied, so the
contract fixes a qualifying resource class and controlled network shape. Every
release record must still name the exact device and managed-preview location it
actually used.

## Decision

### Physical client profile

The first-release quantitative client evidence uses a physical laptop with:

- four physical CPU cores available to the browser, with simultaneous
  multithreading allowed;
- 8 GiB of system memory;
- integrated graphics, with no discrete GPU active for the measured browser;
- AC power, the operating system's ordinary balanced/default power mode, and no
  thermal-throttling indication;
- a vendor-supported desktop operating system and the current stable Google
  Chrome product under ADR-023; and
- a clean browser profile with no extensions, developer tools, recording,
  screen sharing, or unrelated foreground work.

This is a controlled release-regression profile, not a user-facing minimum
hardware promise. A faster or more generously provisioned device may produce
diagnostics, but cannot be the sole release evidence. If the exact qualifying
machine has not yet been identified, the release evidence remains `PENDING`;
the device model, CPU, GPU, memory, OS, browser version, power state, and cooling
conditions are mandatory fields in the final record.

Run both renderer viewport targets on that same machine:

- 1366×768 CSS pixels at DPR 1; and
- 1920×1080 CSS pixels at DPR 2.

The higher-density target may use a browser context whose backing surface is
larger than the physical panel. It must still use the physical integrated GPU.
The selected React DOM renderer is the release target. Pixi results are
diagnostic and cannot substitute for React DOM evidence.

### Network and managed-preview profile

End-to-end authority and recovery measurements run against a managed Cloudflare
preview deployment, not local `workerd`. Shape the entire browser process,
including HTTP and WebSocket traffic, to the standard same-region profile:

- 50 ms median client-to-preview round-trip time, with an allowed 40–60 ms
  pre-run calibration window;
- 10 Mbit/s downstream and 2 Mbit/s upstream;
- no more than 10 ms added jitter; and
- 0.1% packet loss.

Record the client location, Cloudflare colo/region evidence, shaping tool and
settings, and at least 20 uncached health-request calibration samples. If the
natural path is faster, add delay across the whole process. If it cannot be
held inside the calibration window, the run is diagnostic rather than the
standard-profile release result.

Also run a recovery-stress profile at 120 ms round-trip time, 5 Mbit/s down,
1 Mbit/s up, up to 20 ms jitter, and 1% packet loss. It is a correctness and
bounded-recovery test; the standard-profile command-latency budget is not
silently applied to it. Security, privacy, convergence, idempotency, and the
absence of acknowledged-state loss remain mandatory in both profiles.

### Sampling and pass rule

- Use the exact release-candidate build and deterministic representative
  fixture/assets. Compare v1 and v2 on the same machine, browser, viewport, and
  run window.
- Keep three independent measured repetitions. Warm each action path at least
  ten times, then retain at least 100 observations per warmed latency metric.
  Use the nearest-rank percentile method already used by the repository.
- Do not rerun or discard an unfavorable valid result. An invalid environment
  may be discarded only for a recorded cause established before inspecting its
  performance values.
- Every repetition must pass the absolute renderer, resource, and standard-
  network budgets in the verification plan.
- For protected v1/v2 latency parity, the median of the three paired p95 ratios
  must be at most 1.05 and no repetition may exceed 1.10. The 5% band is the
  measurement tolerance for “no worse,” not permission to relax an absolute
  budget.
- V2 must improve at least one named legacy bottleneck by at least 20% in the
  median paired p95, with the workflow and start/end marks fixed before the run.
- Attach raw samples, summaries, environment metadata, build identifiers,
  failure output, and artifact digests. Summaries without raw bounded evidence
  do not pass.

The absolute budgets and network objectives in
[`06-verification-and-success-criteria.md`](./06-verification-and-success-criteria.md)
are ratified unchanged by this decision. Changing a threshold, tolerance,
fixture, target viewport, or network shape requires an explicit ADR amendment;
raising a limit merely because a candidate missed it is not allowed.

## Tooling and evidence boundary

`pnpm run measure:v2:renderer` builds production assets and runs the controlled
120-card renderer observation three times at each viewport in current stable,
headful Chrome. It records browser, CPU exposure, memory exposure, screen,
viewport, DPR, and WebGL vendor/renderer metadata plus 100-sample p50/p95
reconciliation evidence. `PTCGSIM_CHROME_PATH` may select the exact stable Chrome
binary.

`PTCGSIM_PERFORMANCE_HEADLESS=1` exists only to validate the harness. Headless
output and any GPU string containing SwiftShader, llvmpipe, software rasterizer,
or a basic render driver are diagnostic and never satisfy physical evidence.
The renderer observation also does not replace protected v1/v2 workflow,
real-raster decoded-memory, drag/long-task, managed-network, or soak evidence.

`pnpm run measure:v2:server` remains a named local-runtime observation. It does
not satisfy the managed-preview network profile. Use
[`PERFORMANCE_RELEASE_EVIDENCE.md`](./PERFORMANCE_RELEASE_EVIDENCE.md) to join
these inputs with the outstanding physical and managed-preview results.

## Consequences

- CI continues to catch regressions without pretending shared hosted hardware
  or software rendering is a physical performance certification.
- The project can change the exact laptop model when necessary while retaining
  the approved lower-end resource class and a fully named audit trail.
- A missing qualifying device or managed-preview run blocks the performance
  sign-off; it is not converted into a pass by documentation or synthetic data.
- The two viewport/DPR targets and network shape make release-to-release results
  comparable without broadening UI/UX or browser support.

## Revisit triggers

Revisit this ADR if telemetry shows the player population needs a lower hardware
class or different latency region, the selected renderer changes, Chrome no
longer exposes sufficient GPU evidence, the hosting platform changes, or three
consecutive stable releases show enough margin to justify a stricter budget.

This decision changes measurement and release policy only. It changes no game
state, protocol, storage, UI, or production routing.
