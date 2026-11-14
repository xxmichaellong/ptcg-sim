# Multi-agent architecture audit guide

## Goal

Many agents or people should be able to challenge this blueprint without creating
many conflicting “truth” documents. Review work is parallel; canonical integration
is serialized and traceable.

## Canonical versus review files

- Files in the root of `docs/v2-rebuild/` are canonical proposals.
- Reviewers add one isolated report under `docs/v2-rebuild/reviews/`.
- Review reports may include exact replacement prose or a patch, but do not
  directly and concurrently rewrite canonical files.
- One named integrator applies accepted changes to every affected canonical file,
  updates requirements/decision/risk references, and records disposition.
- An ADR becomes the authority when an accepted decision differs from earlier
  proposal text; canonical documents must then be brought into agreement.

This model lets all reviewers “edit” the architecture through concrete proposals
while avoiding last-writer-wins changes to state/protocol contracts.

## Review report naming and metadata

```text
reviews/YYYY-MM-DD-<lane>-<reviewer>.md
```

Each report starts with:

```text
Blueprint revision/commit:
Review lane:
Reviewer:
Date:
Files/requirements reviewed:
Repo evidence inspected:
Overall verdict: accept | accept-with-changes | reject
```

Do not include secrets, real private decks, save tokens, or user data in reports.

## Finding format

```text
Finding ID: <report-prefix>-001
Severity: BLOCKING | HIGH | MEDIUM | LOW | QUESTION
Requirements: VIS-002, PROTO-004
Canonical sections:
Repository evidence: exact file:line and observed behavior
Problem:
Failure scenario:
Recommended change:
Alternatives considered:
Security/privacy impact:
Persistence/schema/protocol impact:
UI/UX parity impact:
Tests and measurable exit gate:
Migration/rollback impact:
Suggested owner:
```

`BLOCKING` means implementation could encode an unsafe or incompatible decision;
it is not a synonym for reviewer preference. A reviewer proposing a new feature
must identify it as out of scope rather than treating omission as a defect.

## Audit lanes

### Domain correctness and manual-tabletop semantics

Check:

- every legacy action/workflow has an unambiguous command/event/presentation map;
- stable identity and ordered-zone/stack/work-area model can represent real
  fixtures, cross-owner placement, BREAK, markers, and arbitrary manual moves;
- rejected and composite actions are atomic;
- event application/replay/invariants are deterministic and versionable;
- no Pokémon rules enforcement slipped into structural validation; and
- undo/setup/reset/turn/stadium/active-bench behaviors are explicitly decided.

### Network, identity, hidden information, and security

Check:

- actor/role/room derives from capability-bound connection;
- admission, resume, supersession, idempotency and sequence survive restart;
- durable commit/publication/result order covers every crash window;
- every role has an explicit projection and permission matrix;
- hidden data cannot leak through handles, errors, timeline, definitions, assets,
  logs, replay, saves, caches, or accessibility;
- payload/rate/config/image/import threats have bounded failure behavior; and
- reused MagicCircle patterns do not assume common broadcast state.

### Renderer, UI parity, input, assets, and accessibility

Check:

- parity inventory includes exact layout, all modes/settings/overlays and keymap;
- renderer comparison is fair and measured rather than predetermined;
- renderer consumes views/emits intents with no logical mutation;
- pointer cancellation, board flip, resize, overlays and z-order cover boundary
  cases;
- asset CORS/proxy, private texture, async generation and resource ownership are
  explicit;
- no continuous idle loop or accidental visual redesign; and
- native controls and canvas-replaced semantics remain accessible.

### Migration, compatibility, persistence, and operations

Check:

- a live session cannot mix engine/protocol generations;
- v1 conversion covers structural version ambiguity and fails transactionally;
- event/checkpoint/save schemas migrate/rollback without acknowledged loss;
- cohort routing is sticky and v1 retirement is delayed/recoverable;
- metrics contain enough safe evidence to pause/diagnose a rollout;
- phase estimates/dependencies/gates are realistic and no “testing later” phase
  hides missing slice work; and
- deletion/retention actions require separate authorization.

### Performance and quality engineering

Check:

- baseline fixtures/hardware/browsers are reproducible;
- budgets measure user latency and bounded resources, not only average FPS;
- test layers include real WebGL/browser/transport/storage boundaries;
- fault injection covers every durable transaction boundary;
- property/model tests persist reproducible failing seeds;
- screenshots are paired with structured geometry and semantic assertions; and
- load/soak tests enforce history/cache/outbox/resource bounds.

### Maintainability and contributor experience

Check:

- package boundaries and public APIs are small and acyclic;
- clock/RNG/storage/transport/assets have explicit adapters;
- no proposed giant engine/room/store manager is accumulating concerns;
- file ownership and vertical slices permit parallel work;
- schema changes have migration and consumer plan; and
- docs/fixtures/examples make core workflows understandable without tribal
  knowledge.

## Repository-evidence standard

Findings about current behavior cite exact local file and line or a reproducible
test/trace. Findings about a library/runtime cite current official documentation
and, when behavior matters, a minimal spike. An analogy to MagicCircle is not
enough; cite the relevant local file and explain which assumptions transfer.

## Integration process

1. Freeze a blueprint revision/commit for the audit round.
2. Assign lanes; allow cross-lane findings but avoid duplicate full-repo reviews.
3. Reviewers commit isolated reports only.
4. Integrator deduplicates findings and requests evidence where necessary.
5. Each finding receives `accepted`, `accepted-with-modification`, `deferred`, or
   `rejected`, with rationale and owner.
6. Accepted findings update canonical prose, `REQUIREMENTS.md`, decision/risk
   register, tests/gates, and phase/file map together.
7. Run link/format/contradiction checks and request focused re-review of affected
   contracts.
8. Publish an audit summary listing remaining blockers and the new blueprint
   revision.

Disagreement is resolved by evidence and the named decision owner, not majority
vote. Product semantics go to the product owner; privacy/security guarantees
cannot be weakened without the security owner; architecture owners resolve
implementation alternatives within those constraints.

## ADR template

Create `docs/v2-rebuild/adr/NNNN-short-title.md`:

```text
# ADR-NNNN: Title
Status: proposed | accepted | superseded | rejected
Date:
Owners/reviewers:
Requirements:

## Context and repository evidence
## Decision drivers
## Options
## Decision
## Consequences
## Security/privacy
## UI/UX parity
## Persistence/schema/protocol
## Migration and rollback
## Tests and measured evidence
## Revisit trigger/date
```

An ADR must state why alternatives lost and what observation would cause the
decision to be revisited.

## Change proposal checklist

Before changing canonical architecture, answer:

- Which requirement IDs and legacy parity rows change?
- Does this alter public UX or add Pokémon rules?
- Does it expose, persist, log, or request new hidden information?
- Does canonical/wire/event/save schema change, and how does old data migrate?
- Does it change durability, idempotency, or crash semantics?
- Which tests fail before and pass after the change?
- Which performance/resource budget changes, with measurement?
- Can an active room cross the change safely?
- What disables or rolls it back?
- Which documents and owners must agree?

## Audit completion gate

The blueprint is auditable-complete, not eternally perfect, when:

- every canonical document has at least one lane owner review;
- domain/network/visibility/renderer/migration have independent adversarial
  review;
- all `BLOCKING` findings and decision-register blockers are resolved or have an
  approved spike/product-decision owner and Phase 0 cannot exit until resolution;
- every accepted finding is traceable into requirements and a measurable gate;
- contradiction and link checks pass; and
- the product owner approves the parity contract and explicit non-goals.
