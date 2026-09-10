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

/**
 * Replays a fixture's own `operationTraceByScenario` script inside the real v1
 * client and reports what actually happened.
 *
 * The compound-lower fixtures record a complete, ordered operation script per
 * scenario, which makes them replayable against the source they claim to
 * describe. Feeding that script back through v1's real `moveCardBundle` and
 * `rotateCard` turns each fixture from a self-recorded assertion into a
 * falsifiable one: if the recorded indices, rotations or BREAK flags disagree
 * with v1, the replay diverges.
 *
 * The trace's `refresh:` entries are the `resetRotation` side effect of an
 * evolution rather than operations of their own, so only `evolve:` and
 * `rotate:` steps are executed.
 */
export const replayCompoundTrace = async (
  page: Page,
  slot: CompoundSlot,
  trace: readonly string[],
  phaseCount: number
): Promise<readonly ReplayedPhase[]> =>
  page.evaluate(
    async ({ zoneId, operations, phases }) => {
      const load = (specifier: string): Promise<Record<string, never>> =>
        import(/* @vite-ignore */ specifier);
      const [
        cardModule,
        placementModule,
        zoneModule,
        bundleModule,
        rotateModule,
      ] = await Promise.all([
        load('/src/setup/deck-constructor/card.js'),
        load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
        load('/src/setup/zones/get-zone.js'),
        load('/src/actions/move-card-bundle/move-card-bundle.js'),
        load('/src/actions/general/rotate-card.js'),
      ]);

      interface LegacyCard {
        readonly name: string;
        readonly image: HTMLImageElement;
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

      const quarterTurns = (image: HTMLImageElement): number => {
        const degrees =
          Number.parseInt(image.style.transform.replace(/[^0-9-]/gu, ''), 10) ||
          0;
        return (((degrees / 90) % 4) + 4) % 4;
      };
      const container = (): HTMLElement =>
        byRole.get('base')!.image.parentElement as HTMLElement;
      const sample = () => {
        const roles = ['base', 'middle', 'top'] as const;
        const turns = {} as Record<string, number>;
        const flags = {} as Record<string, boolean>;
        for (const role of roles) {
          const card = byRole.get(role);
          turns[role] = card ? quarterTurns(card.image) : 0;
          flags[role] = Boolean(
            card &&
            (card.image as unknown as { PokémonBreak?: boolean })[
              'PokémonBreak'
            ]
          );
        }
        const element = container();
        return {
          quarterTurns: turns,
          breakFlags: flags,
          inlineMargins: [
            element.style.marginRight,
            element.style.marginLeft,
          ] as const,
        };
      };

      // Every two-phase trace captures immediately before its final operation
      // and again after it; the final operation is the transition the fixture
      // is named for.
      const boundary = operations.length - (phases - 1);
      const samples: ReturnType<typeof sample>[] = [];

      for (const [index, operation] of operations.entries()) {
        if (index === boundary) samples.push(sample());
        const evolve = /^evolve:([a-z]+)->([a-z]+)$/u.exec(operation);
        if (evolve) {
          const [, parentName, childName] = evolve;
          const child = await make(childName!);
          byRole.set(childName!, child);
          hand.array.push(child);
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
          continue;
        }
        const rotate = /^rotate:[a-z]+:index=(\d+):single=(true|false):/u.exec(
          operation
        );
        if (rotate) {
          const [, index_, single] = rotate;
          rotateCard(
            'self',
            zoneId,
            Number.parseInt(index_!, 10),
            single === 'true',
            false
          );
          await frames();
          continue;
        }
        if (operation.startsWith('refresh:')) continue;
        throw new Error(`Unreplayable trace operation: ${operation}`);
      }
      samples.push(sample());
      return samples;
    },
    { zoneId: slot, operations: trace, phases: phaseCount }
  );

/**
 * Replays the refresh fixture through v1's real `refreshBoard` reconstruction.
 *
 * The earlier direct-operation gate deliberately ignores `refresh:` trace
 * annotations because most fixtures use them only to describe the implicit
 * reset performed by evolution. This fixture is different: its final refresh
 * is the behavior under test, and the following `replay-rotate:` records are
 * effects that `refreshBoard` must reproduce itself. Capture therefore stops
 * before the last refresh annotation, samples the synchronous reconstruction,
 * then samples again after the legacy empty-wrapper observer settles.
 */
export const replayCompoundRefreshTrace = async (
  page: Page,
  slot: CompoundSlot,
  trace: readonly string[]
): Promise<ReplayedRefresh> =>
  page.evaluate(
    async ({ zoneId, operations }) => {
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
        readonly attached?: boolean;
        readonly PokémonBreak?: boolean;
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

      for (const candidateZoneId of ['active', 'bench']) {
        const candidate = getZone('self', candidateZoneId);
        candidate.array.length = 0;
        candidate.element.replaceChildren();
      }
      const zone = getZone('self', zoneId);
      const hand = getZone('self', 'hand');
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
      const frames = () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      const byRole = new Map<string, LegacyCard>();
      const base = await make('base');
      byRole.set('base', base);
      zone.array.push(base);
      initializeActiveBenchCard('self', base, zoneId, zone);
      await frames();

      const quarterTurns = (image: HTMLImageElement): number => {
        const degrees =
          Number.parseInt(image.style.transform.replace(/[^0-9-]/gu, ''), 10) ||
          0;
        return (((degrees / 90) % 4) + 4) % 4;
      };
      const container = (): HTMLElement => {
        const element = byRole.get('base')?.image.parentElement;
        if (!(element instanceof HTMLElement)) {
          throw new Error('Real-v1 compound card has no play container');
        }
        return element;
      };
      const sample = () => {
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
        };
      };
      const execute = async (operation: string): Promise<void> => {
        const evolve = /^evolve:([a-z]+)->([a-z]+)$/u.exec(operation);
        if (evolve) {
          const [, parentName, childName] = evolve;
          const child = await make(childName!);
          byRole.set(childName!, child);
          hand.array.push(child);
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
          return;
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
          return;
        }
        if (operation.startsWith('refresh:')) return;
        throw new Error(`Unreplayable pre-refresh operation: ${operation}`);
      };

      const refreshIndex = operations.findLastIndex((operation) =>
        operation.startsWith('refresh:')
      );
      if (refreshIndex < 0) {
        throw new Error('Refresh fixture trace has no refresh boundary');
      }
      for (const operation of operations.slice(0, refreshIndex)) {
        await execute(operation);
      }

      const originalImages = new Map(
        [...byRole].map(([role, card]) => [role, card.image])
      );
      const oldWrapper = container();
      const phases = [sample()];
      refreshBoard();
      const newWrapper = container();
      phases.push(sample());
      const synchronousWrapperCount = zone.element.querySelectorAll(
        ':scope > .play-container'
      ).length;
      const oldWrapperConnectedImmediately = oldWrapper.isConnected;
      const wrapperIdentityChanged = oldWrapper !== newWrapper;
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
          stableWrapperCount: zone.element.querySelectorAll(
            ':scope > .play-container'
          ).length,
          oldWrapperConnectedAfterSettle: oldWrapper.isConnected,
          wrapperIdentityChanged,
          cardNodeIdentityPreserved,
        },
      };
    },
    { zoneId: slot, operations: trace }
  );

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
