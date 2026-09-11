import type { Page } from '@playwright/test';

import { loadLegacyRuntime } from './legacy-runtime.js';

export type CompoundSlot = 'active' | 'bench';

/** One captured phase: what the three images look like at a trace boundary. */
export interface ReplayedPhase {
  readonly quarterTurns: Readonly<Record<string, number>>;
  readonly breakFlags: Readonly<Record<string, boolean>>;
  /** `[marginRight, marginLeft]` on the shared play container. */
  readonly inlineMargins: readonly [string, string];
}

export interface ReplayedGeometryPhase extends ReplayedPhase {
  /** Frame-local x of the play container, as the fixtures record it. */
  readonly stackX: number;
}

export interface ReplayedRefreshLifecycle {
  readonly synchronousWrapperCount: number;
  readonly oldWrapperConnectedImmediately: boolean;
  readonly stableWrapperCount: number;
  readonly oldWrapperConnectedAfterSettle: boolean;
  readonly wrapperIdentityChanged: boolean;
  readonly cardNodeIdentityPreserved: boolean;
}

export interface ReplayedRefresh {
  readonly phases: readonly ReplayedPhase[];
  readonly lifecycle: ReplayedRefreshLifecycle;
}

export interface ReplayedReconstruct {
  readonly phases: readonly ReplayedPhase[];
  /** Real `refreshBoard` calls performed, excluding evolution's own reset. */
  readonly reconstructionCount: number;
  /** Whether a reconstruction actually replaced the play container. */
  readonly wrapperIdentityChanged: boolean;
}

export interface ReplayedPhaseTrace {
  readonly phases: readonly ReplayedGeometryPhase[];
  /** `zone.array` order, which is what v1 indexes rotations by. */
  readonly logicalRoles: readonly string[];
  /** Child order inside the play container. */
  readonly domRoles: readonly string[];
  readonly reconstructionCount: number;
  readonly wrapperIdentityChanged: boolean;
}

/**
 * How a trace is executed and where it is sampled.
 *
 * - `direct` treats every `refresh:` as the implicit reset an evolution
 *   performs and never calls `refreshBoard`.
 * - `reconstruct` additionally runs a real `refreshBoard` for any `refresh:`
 *   that is not an evolution's own reset.
 * - `refreshBoundary` stops before the trace's last `refresh:` and measures
 *   that reconstruction itself, synchronously and after it settles.
 * - `everyPhase` runs like `reconstruct` but samples after every executed step
 *   rather than only around one transition.
 */
type ReplayMode = 'direct' | 'reconstruct' | 'refreshBoundary' | 'everyPhase';

interface ReplayResult {
  readonly phases: readonly ReplayedGeometryPhase[];
  readonly lifecycle: ReplayedRefreshLifecycle | null;
  readonly logicalRoles: readonly string[];
  readonly domRoles: readonly string[];
  readonly reconstructionCount: number;
  readonly wrapperIdentityChanged: boolean;
}

/**
 * Replays a fixture's own recorded operation script inside the real v1 client
 * and reports what actually happened.
 *
 * The compound fixtures record a complete, ordered script per scenario, which
 * makes them replayable against the source they claim to describe. Feeding that
 * script back through v1's real `moveCardBundle`, `rotateCard` and
 * `refreshBoard` turns each fixture from a self-recorded assertion into a
 * falsifiable one: if the recorded indices, rotations, BREAK flags or geometry
 * disagree with v1, the replay diverges.
 *
 * Across every checked-in compound trace a `refresh:` that immediately follows
 * an `evolve:` is the implicit `resetRotation` that evolution performs, and any
 * other `refresh:` is a genuine reconstruction -- which is what the modes above
 * distinguish. A `replay-rotate:` is never executed: it records a rotation
 * `refreshBoard` reapplies by itself, so replaying it by hand would turn the
 * stack twice and hide a reconstruction that failed to restore it.
 */
const runCompoundReplay = (
  page: Page,
  slot: CompoundSlot,
  trace: readonly string[],
  mode: ReplayMode,
  phaseCount: number
): Promise<ReplayResult> =>
  page.evaluate(
    async ({ zoneId, operations, replayMode, expectedPhases }) => {
      const load = (specifier: string): Promise<Record<string, never>> =>
        import(/* @vite-ignore */ specifier);
      const [
        cardModule,
        placementModule,
        zoneModule,
        bundleModule,
        rotateModule,
        refreshModule,
      ] = await Promise.all([
        load('/src/setup/deck-constructor/card.js'),
        load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
        load('/src/setup/zones/get-zone.js'),
        load('/src/actions/move-card-bundle/move-card-bundle.js'),
        load('/src/actions/general/rotate-card.js'),
        load('/src/setup/sizing/refresh-board.js'),
      ]);

      interface LegacyImage extends HTMLImageElement {
        PokémonBreak?: boolean;
      }
      interface LegacyCard {
        readonly name: string;
        readonly image: LegacyImage;
      }
      interface LegacyZone {
        readonly element: HTMLElement;
        readonly array: LegacyCard[];
      }
      const Card = (
        cardModule as unknown as {
          readonly Card: new (
            user: string,
            name: string,
            type: string,
            imageUrl: string
          ) => LegacyCard;
        }
      ).Card;
      const { initializeActiveBenchCard } = placementModule as unknown as {
        readonly initializeActiveBenchCard: (
          user: string,
          card: LegacyCard,
          zoneId: string,
          zone: LegacyZone
        ) => void;
      };
      const { getZone } = zoneModule as unknown as {
        readonly getZone: (user: string, zoneId: string) => LegacyZone;
      };
      const { moveCardBundle } = bundleModule as unknown as {
        readonly moveCardBundle: (
          user: string,
          initiator: string,
          oZoneId: string,
          dZoneId: string,
          index: number,
          targetIndex: number,
          action: string,
          emit?: boolean
        ) => void;
      };
      const { rotateCard } = rotateModule as unknown as {
        readonly rotateCard: (
          user: string,
          zoneId: string,
          index: number,
          single?: boolean,
          emit?: boolean
        ) => void;
      };
      const { refreshBoard } = refreshModule as unknown as {
        readonly refreshBoard: () => void;
      };

      const zone = getZone('self', zoneId);
      const hand = getZone('self', 'hand');
      zone.array.length = 0;
      zone.element.replaceChildren();
      hand.array.length = 0;
      hand.element.replaceChildren();

      const make = async (name: string): Promise<LegacyCard> => {
        const card = new Card(
          'self',
          name,
          'Pokémon',
          `${location.origin}/src/assets/cardback.png`
        );
        await card.image.decode();
        return card;
      };

      const byRole = new Map<string, LegacyCard>();
      const base = await make('base');
      byRole.set('base', base);
      zone.array.push(base);
      initializeActiveBenchCard('self', base, zoneId, zone);

      const frames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      await frames();

      const quarterTurns = (image: LegacyImage): number => {
        const degrees =
          Number.parseInt(image.style.transform.replace(/[^0-9-]/gu, ''), 10) ||
          0;
        return (((degrees / 90) % 4) + 4) % 4;
      };
      // Resolved fresh on every use: a reconstruction replaces the wrapper. The
      // cards live in the self-player iframe, so presence is the correct
      // structural guard -- a top-window `instanceof HTMLElement` rejects a
      // valid cross-realm element.
      const container = (): HTMLElement => {
        const element = byRole.get('base')?.image.parentElement;
        if (!element) {
          throw new Error('Real-v1 compound card has no play container');
        }
        return element as HTMLElement;
      };
      const wrapperCount = () =>
        zone.element.querySelectorAll(':scope > .play-container').length;
      const sample = (): ReplayedGeometryPhase => {
        const turns: Record<string, number> = {};
        const flags: Record<string, boolean> = {};
        for (const role of ['base', 'middle', 'top'] as const) {
          const card = byRole.get(role);
          turns[role] = card ? quarterTurns(card.image) : 0;
          flags[role] = Boolean(card?.image.PokémonBreak);
        }
        const element = container();
        return {
          quarterTurns: turns,
          breakFlags: flags,
          inlineMargins: [
            element.style.marginRight,
            element.style.marginLeft,
          ] as const,
          stackX: element.getBoundingClientRect().x,
        };
      };

      let reconstructionCount = 0;
      let wrapperIdentityChanged = false;

      const reconstruct = async (): Promise<void> => {
        const before = container();
        refreshBoard();
        reconstructionCount += 1;
        if (container() !== before) wrapperIdentityChanged = true;
        await frames();
      };

      /** Runs one operation. Returns whether it produced a phase boundary. */
      const execute = async (
        operation: string,
        previous: string
      ): Promise<boolean> => {
        const evolve = /^evolve:([a-z]+)->([a-z]+)$/u.exec(operation);
        if (evolve) {
          const [, parentName, childName] = evolve;
          const child = await make(childName!);
          byRole.set(childName!, child);
          hand.array.push(child);
          hand.element.append(child.image);
          const targetIndex = zone.array.findIndex(
            (card) => card.name === parentName
          );
          moveCardBundle(
            'self',
            'self',
            'hand',
            zoneId,
            hand.array.length - 1,
            targetIndex,
            'evolve',
            false
          );
          await frames();
          return false;
        }
        const rotate = /^rotate:[a-z]+:index=(\d+):single=(true|false):/u.exec(
          operation
        );
        if (rotate) {
          const [, index, single] = rotate;
          rotateCard(
            'self',
            zoneId,
            Number.parseInt(index!, 10),
            single === 'true',
            false
          );
          await frames();
          return true;
        }
        if (operation.startsWith('refresh:')) {
          // Only a refresh that is not an evolution's own reset is a real
          // reconstruction, and only `direct` declines to run it.
          if (replayMode === 'direct' || previous.startsWith('evolve:')) {
            return false;
          }
          await reconstruct();
          return true;
        }
        if (operation.startsWith('replay-rotate:')) {
          if (replayMode === 'direct') {
            throw new Error(`Unreplayable trace operation: ${operation}`);
          }
          return false;
        }
        throw new Error(`Unreplayable trace operation: ${operation}`);
      };

      const previousOf = (index: number) =>
        index > 0 ? operations[index - 1]! : '';

      if (replayMode === 'refreshBoundary') {
        // The trace's last refresh is the behaviour under test, so everything
        // before it is setup and the reconstruction is measured directly.
        const refreshIndex = operations.findLastIndex((operation) =>
          operation.startsWith('refresh:')
        );
        if (refreshIndex < 0) {
          throw new Error('Refresh fixture trace has no refresh boundary');
        }
        for (const [index, operation] of operations
          .slice(0, refreshIndex)
          .entries()) {
          await execute(operation, previousOf(index));
        }

        const originalImages = new Map(
          [...byRole].map(([role, card]) => [role, card.image])
        );
        const oldWrapper = container();
        const phases = [sample()];
        refreshBoard();
        reconstructionCount += 1;
        const newWrapper = container();
        phases.push(sample());
        const synchronousWrapperCount = wrapperCount();
        const oldWrapperConnectedImmediately = oldWrapper.isConnected;
        wrapperIdentityChanged = oldWrapper !== newWrapper;
        const cardNodeIdentityPreserved = [...originalImages].every(
          ([role, image]) => byRole.get(role)?.image === image
        );
        await frames();
        phases.push(sample());

        return {
          phases,
          lifecycle: {
            synchronousWrapperCount,
            oldWrapperConnectedImmediately,
            stableWrapperCount: wrapperCount(),
            oldWrapperConnectedAfterSettle: oldWrapper.isConnected,
            wrapperIdentityChanged,
            cardNodeIdentityPreserved,
          },
          logicalRoles: zone.array.map((card) => card.name),
          domRoles: [...container().querySelectorAll('img')].map((image) => {
            for (const [role, card] of byRole) {
              if (card.image === image) return role;
            }
            return 'unknown';
          }),
          reconstructionCount,
          wrapperIdentityChanged,
        };
      }

      const phases: ReplayedGeometryPhase[] = [];
      // `everyPhase` samples after each executed step, starting from a pristine
      // sample once the stack is built; the others sample only around the
      // transition their fixture is named for.
      const boundary =
        replayMode === 'everyPhase'
          ? -1
          : operations.length - (expectedPhases - 1);
      let built = false;

      for (const [index, operation] of operations.entries()) {
        const previous = previousOf(index);
        if (replayMode !== 'everyPhase' && index === boundary) {
          phases.push(sample());
        }
        if (
          replayMode === 'everyPhase' &&
          !built &&
          !operation.startsWith('evolve:') &&
          !operation.startsWith('refresh:')
        ) {
          // No settling refresh is forced here. `evolveCard` sizes the play
          // container from `movingCard.image.clientWidth`, which is still 0 for
          // a freshly inserted image, so the container's width before the
          // trace's own first reconstruction depends on when layout and v1's
          // empty-wrapper observer happen to run -- and that timing lands
          // differently for the active and bench slots. Callers should treat
          // pre-reconstruction stack x as unsettled; everything from the first
          // reconstruction on is stable and exact.
          phases.push(sample());
          built = true;
        }
        const isBoundary = await execute(operation, previous);
        if (replayMode === 'everyPhase' && isBoundary) {
          phases.push(sample());
        }
      }
      if (replayMode !== 'everyPhase') phases.push(sample());

      return {
        phases,
        lifecycle: null,
        logicalRoles: zone.array.map((card) => card.name),
        domRoles: [...container().querySelectorAll('img')].map((image) => {
          for (const [role, card] of byRole) {
            if (card.image === image) return role;
          }
          return 'unknown';
        }),
        reconstructionCount,
        wrapperIdentityChanged,
      };
    },
    {
      zoneId: slot,
      operations: trace,
      replayMode: mode,
      expectedPhases: phaseCount,
    }
  );

/**
 * Replays a trace whose `refresh:` entries are only the implicit reset that
 * evolution performs, sampling around the transition it is named for.
 */
export const replayCompoundTrace = async (
  page: Page,
  slot: CompoundSlot,
  trace: readonly string[],
  phaseCount: number
): Promise<readonly ReplayedPhase[]> =>
  (await runCompoundReplay(page, slot, trace, 'direct', phaseCount)).phases;

/**
 * Replays a trace whose final `refresh:` is the behaviour under test, through
 * v1's real `refreshBoard`, sampling before it, synchronously after it, and
 * again once the legacy empty-wrapper observer settles.
 */
export const replayCompoundRefreshTrace = async (
  page: Page,
  slot: CompoundSlot,
  trace: readonly string[]
): Promise<ReplayedRefresh> => {
  const result = await runCompoundReplay(
    page,
    slot,
    trace,
    'refreshBoundary',
    3
  );
  if (!result.lifecycle) {
    throw new Error('Refresh replay returned no reconstruction evidence');
  }
  return { phases: result.phases, lifecycle: result.lifecycle };
};

/**
 * Replays a trace that reconstructs the board partway through and then carries
 * on, sampling around the transition it is named for.
 *
 * Note what those samples can and cannot show. A rotate/refresh/replay-rotate
 * run is state-neutral by construction, so they would look identical if
 * `refreshBoard` did nothing at all. The reconstruction evidence returned
 * alongside them is what makes the call load-bearing, and callers should
 * assert it.
 */
export const replayCompoundReconstructTrace = async (
  page: Page,
  slot: CompoundSlot,
  trace: readonly string[],
  phaseCount: number
): Promise<ReplayedReconstruct> => {
  const result = await runCompoundReplay(
    page,
    slot,
    trace,
    'reconstruct',
    phaseCount
  );
  return {
    phases: result.phases,
    reconstructionCount: result.reconstructionCount,
    wrapperIdentityChanged: result.wrapperIdentityChanged,
  };
};

/**
 * Replays a trace that records one named phase per executed step, sampling at
 * every one of them and reporting the stack topology alongside.
 */
export const replayCompoundPhaseTrace = async (
  page: Page,
  slot: CompoundSlot,
  trace: readonly string[]
): Promise<ReplayedPhaseTrace> =>
  runCompoundReplay(page, slot, trace, 'everyPhase', 0);

/** Opens one real-v1 page for a whole fixture's worth of replays. */
export const withLegacyRuntimePage = async <Value>(
  page: Page,
  viewport: {
    readonly width: number;
    readonly height: number;
    readonly devicePixelRatio: number;
  },
  run: () => Promise<Value>
): Promise<Value> => {
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await loadLegacyRuntime(page);
  return run();
};
