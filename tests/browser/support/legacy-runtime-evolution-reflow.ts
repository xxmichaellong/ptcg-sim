import type { Page } from '@playwright/test';

import { captureLegacyRuntimeLayout } from './legacy-runtime-layout.js';
import { loadLegacyRuntime } from './legacy-runtime.js';

export type EvolutionSide = 'local' | 'opponent';
export type EvolutionSlot = 'active' | 'bench';

export interface EvolutionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface EvolutionStageCard {
  readonly id: string;
  readonly frameLocalBounds: EvolutionRect;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly localRotationDegrees: number;
  readonly zIndex: number;
  readonly layer: number;
  readonly energyLayer: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly position: string;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly domOrdinal: number;
  readonly logicalOrdinal: number;
}

export interface EvolutionStage {
  readonly logicalOrder: readonly string[];
  readonly domOrder: readonly string[];
  readonly containerFrameLocalBounds: EvolutionRect;
  readonly containerClientWidth: number;
  readonly computedWidthPx: number;
  readonly authoredWidthPx: number | null;
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly cards: readonly EvolutionStageCard[];
}

export interface EvolutionCard extends EvolutionStageCard {
  readonly side: EvolutionSide;
  readonly role: 'topEvolution' | 'lowerEvolution';
  readonly physicalBounds: EvolutionRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly effectiveRotationDegrees: number;
  readonly sourcePath: string;
}

export interface EvolutionStack {
  readonly id: string;
  readonly side: EvolutionSide;
  readonly physicalBounds: EvolutionRect;
  readonly frameLocalBounds: EvolutionRect;
  readonly topClientWidth: number;
  readonly topLayer: number;
  readonly preEvolution: EvolutionStage;
  readonly transientResetClientWidth: number;
  readonly transientResetAuthoredWidthPx: number;
  readonly transientPostEvolution: EvolutionStage;
  readonly stablePostRefresh: EvolutionStage;
  readonly synchronousPostRefreshContainerCount: number;
  readonly oldContainerConnectedImmediatelyAfterRefresh: boolean;
  readonly stableContainerCount: number;
  readonly oldContainerConnected: boolean;
  readonly childDomOrder: readonly string[];
  readonly logicalOrder: readonly string[];
  readonly hitOrder: {
    readonly commonOverlap: readonly string[];
    readonly middleAndBaseOverlap: readonly string[];
    readonly outermostBase: readonly string[];
  };
}

export interface RuntimeEvolutionCapture {
  readonly frames: Readonly<Record<EvolutionSide, EvolutionRect>>;
  readonly frameTransforms: Readonly<
    Record<
      EvolutionSide,
      {
        readonly a: number;
        readonly b: number;
        readonly c: number;
        readonly d: number;
        readonly rotationDegrees: number;
      }
    >
  >;
  readonly cards: readonly EvolutionCard[];
  readonly stacks: readonly EvolutionStack[];
  readonly sourceFulfillment: {
    readonly servedPaths: readonly string[];
    readonly blockedExternalOrigins: readonly string[];
    readonly missingSameOriginPaths: readonly string[];
  };
}

type RawEvolutionCard = Omit<
  EvolutionCard,
  'side' | 'role' | 'physicalBounds' | 'effectiveRotationDegrees'
> & { readonly role: 'base' | 'middle' | 'top' };

type RawEvolutionStack = Omit<EvolutionStack, 'side' | 'physicalBounds'>;

/**
 * Drives the exact second-evolution boundary through v1's real move and
 * refresh modules, retaining all four settled stacks for source paint.
 */
export const captureLegacyRuntimeEvolutionReflow = async (
  page: Page
): Promise<RuntimeEvolutionCapture> => {
  const loaded = await loadLegacyRuntime(page);
  const layout = await captureLegacyRuntimeLayout(page);
  const rawCases = await page.evaluate(async () => {
    const load = (specifier: string): Promise<Record<string, never>> =>
      import(/* @vite-ignore */ specifier);
    const [cardModule, zoneModule, bundleModule, moveModule, refreshModule] =
      await Promise.all([
        load('/src/setup/deck-constructor/card.js'),
        load('/src/setup/zones/get-zone.js'),
        load('/src/actions/move-card-bundle/move-card-bundle.js'),
        load('/src/actions/move-card-bundle/move-card.js'),
        load('/src/setup/sizing/refresh-board.js'),
      ]);

    interface LegacyImage extends HTMLImageElement {
      attached?: boolean;
      target?: string;
      relative?: LegacyImage | number;
      layer?: number;
      energyLayer?: number;
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
    const { getZone } = zoneModule as unknown as {
      readonly getZone: (user: string, zoneId: string) => LegacyZone;
    };
    const { moveCardBundle } = bundleModule as unknown as {
      readonly moveCardBundle: (
        user: string,
        initiator: string,
        originZoneId: string,
        destinationZoneId: string,
        index: number,
        targetIndex: number,
        action: string,
        emit?: boolean
      ) => void;
    };
    const { moveCard } = moveModule as unknown as {
      readonly moveCard: (
        user: string,
        initiator: string,
        originZoneId: string,
        destinationZoneId: string,
        index: number,
        targetIndex: number
      ) => void;
    };
    const { refreshBoard } = refreshModule as unknown as {
      readonly refreshBoard: () => void;
    };

    const clearZone = (owner: string, id: string) => {
      const zone = getZone(owner, id);
      zone.array.length = 0;
      for (const image of [...zone.element.querySelectorAll('img')]) {
        image.parentElement?.remove();
        image.remove();
      }
    };
    for (const owner of ['self', 'opp']) {
      for (const id of ['active', 'bench', 'hand', 'discard']) {
        clearZone(owner, id);
      }
    }

    const frames = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    const rectOf = (node: Element): EvolutionRect => {
      const bounds = node.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const cases: Array<{
      readonly side: EvolutionSide;
      readonly cards: readonly RawEvolutionCard[];
      readonly stack: RawEvolutionStack;
    }> = [];

    for (const side of ['local', 'opponent'] as const) {
      const user = side === 'local' ? 'self' : 'opp';
      for (const slot of ['active', 'bench'] as const) {
        const zone = getZone(user, slot);
        const hand = getZone(user, 'hand');
        const stackId = `${side}-${slot}-evolution-stack`;
        const ids = {
          base: `${side}-${slot}-evolution-base`,
          middle: `${side}-${slot}-evolution-middle`,
          top: `${side}-${slot}-evolution-top`,
        } as const;
        const byRole = new Map<'base' | 'middle' | 'top', LegacyCard>();
        const make = async (role: 'base' | 'middle' | 'top') => {
          const card = new Card(
            user,
            role,
            'Pokémon',
            `${location.origin}/src/assets/cardback.png`
          );
          card.image.dataset.legacyRuntimeEvolutionCardId = ids[role];
          await card.image.decode();
          byRole.set(role, card);
          return card;
        };
        const play = async (card: LegacyCard, targetIndex: number) => {
          hand.array.push(card);
          hand.element.append(card.image);
          moveCardBundle(
            user,
            'self',
            'hand',
            slot,
            hand.array.length - 1,
            targetIndex,
            'play',
            false
          );
          await frames();
        };
        const container = (): HTMLElement => {
          const element = byRole.get('base')?.image.parentElement;
          if (!element) throw new Error(`${stackId} has no play container`);
          element.dataset.legacyRuntimeEvolutionStackId = stackId;
          return element;
        };
        const roleOf = (image: Element): 'base' | 'middle' | 'top' => {
          for (const [role, card] of byRole) {
            if (card.image === image) return role;
          }
          throw new Error(`${stackId} contains an unknown card`);
        };
        const idOf = (image: Element): string =>
          (image as HTMLImageElement).dataset.legacyRuntimeEvolutionCardId ??
          '';
        const settle = async () => {
          let prior = '';
          for (let attempt = 0; attempt < 16; attempt += 1) {
            refreshBoard();
            await frames();
            const element = container();
            const images = [...element.querySelectorAll('img')];
            await Promise.all(
              images.map((image) =>
                image.complete && image.naturalWidth > 0
                  ? Promise.resolve()
                  : image.decode()
              )
            );
            await frames();
            const signature = JSON.stringify({
              container: rectOf(element),
              cards: images.map((image) => rectOf(image)),
            });
            if (
              element.clientWidth > 0 &&
              images.every(
                (image) =>
                  image.clientWidth > 0 &&
                  image.clientHeight > 0 &&
                  image.naturalWidth > 0
              ) &&
              signature === prior
            ) {
              return;
            }
            prior = signature;
          }
          throw new Error(`${stackId} never settled`);
        };
        const captureStage = (): EvolutionStage => {
          const element = container();
          const domImages = [
            ...element.querySelectorAll<HTMLImageElement>(':scope > img'),
          ];
          const logicalCards = zone.array.filter((card) =>
            [...byRole.values()].includes(card)
          );
          const styles = getComputedStyle(element);
          return {
            logicalOrder: logicalCards.map((card) => idOf(card.image)),
            domOrder: domImages.map(idOf),
            containerFrameLocalBounds: rectOf(element),
            containerClientWidth: element.clientWidth,
            computedWidthPx: Number.parseFloat(styles.width),
            authoredWidthPx: element.style.width
              ? Number.parseFloat(element.style.width)
              : null,
            inlineMarginRight: element.style.marginRight,
            inlineMarginLeft: element.style.marginLeft,
            computedMarginRightPx: Number.parseFloat(styles.marginRight) || 0,
            computedMarginLeftPx: Number.parseFloat(styles.marginLeft) || 0,
            cards: logicalCards.map((card, logicalOrdinal) => {
              const image = card.image;
              const imageStyles = getComputedStyle(image);
              const matrix = new DOMMatrixReadOnly(imageStyles.transform);
              return {
                id: idOf(image),
                frameLocalBounds: rectOf(image),
                clientWidth: image.clientWidth,
                clientHeight: image.clientHeight,
                localRotationDegrees:
                  ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                  360,
                zIndex: Number.parseInt(imageStyles.zIndex, 10) || 0,
                layer: image.layer ?? 0,
                energyLayer: image.energyLayer ?? 0,
                inlineLeftPx: Number.parseFloat(image.style.left) || 0,
                inlineBottomPx: Number.parseFloat(image.style.bottom) || 0,
                position: imageStyles.position,
                attached: image.attached === true,
                target: image.target ?? '',
                relativeId:
                  typeof image.relative === 'object' && image.relative !== null
                    ? idOf(image.relative)
                    : null,
                domOrdinal: domImages.indexOf(image),
                logicalOrdinal,
              };
            }),
          };
        };

        const base = await make('base');
        await play(base, -1);
        const middle = await make('middle');
        await play(
          middle,
          zone.array.findIndex((card) => card === base)
        );
        await settle();
        const preEvolution = captureStage();

        const top = await make('top');
        hand.array.push(top);
        hand.element.append(top.image);
        // A real evolution begins with an already-rendered hand card.
        // `evolveCard` reads that moving card's integer `clientWidth` before it
        // authors the stack width. Appending adopts this image from the outer
        // document into the player's frame and restarts its load, so wait for
        // that adopted node itself before reproducing the user action.
        await top.image.decode();
        await frames();
        if (top.image.clientWidth === 0) {
          throw new Error(`${stackId} staged hand card has no layout`);
        }
        const oldContainer = container();
        moveCard(
          user,
          'self',
          'hand',
          slot,
          hand.array.length - 1,
          zone.array.findIndex((card) => card === middle)
        );
        const transientPostEvolution = captureStage();
        const transientResetClientWidth = top.image.clientWidth;
        const transientResetAuthoredWidthPx = Number.parseFloat(
          container().style.width
        );

        refreshBoard();
        const synchronousPostRefreshContainerCount =
          zone.element.querySelectorAll(':scope > .play-container').length;
        const oldContainerConnectedImmediatelyAfterRefresh =
          oldContainer.isConnected;
        await frames();
        await settle();
        const stablePostRefresh = captureStage();
        const stableElement = container();
        const stableCards = stablePostRefresh.cards.map((stageCard) => {
          const role = roleOf(
            stableElement.querySelector(
              `[data-legacy-runtime-evolution-card-id="${stageCard.id}"]`
            )!
          );
          const image = byRole.get(role)!.image;
          return {
            ...stageCard,
            role,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            sourcePath: new URL(image.currentSrc).pathname,
          };
        });

        const cardBounds = Object.fromEntries(
          [...byRole].map(([role, card]) => [
            role,
            card.image.getBoundingClientRect(),
          ])
        ) as Record<'base' | 'middle' | 'top', DOMRect>;
        const idsAt = (x: number, y: number) =>
          stableElement.ownerDocument
            .elementsFromPoint(x, y)
            .flatMap((element) => {
              const image = element.closest<HTMLImageElement>(
                '[data-legacy-runtime-evolution-card-id]'
              );
              return image ? [idOf(image)] : [];
            })
            .filter((id, index, all) => id && all.indexOf(id) === index);
        const intersection = (
          bounds: readonly DOMRect[]
        ): { x: number; y: number } => {
          const left = Math.max(...bounds.map((entry) => entry.left));
          const topEdge = Math.max(...bounds.map((entry) => entry.top));
          const right = Math.min(...bounds.map((entry) => entry.right));
          const bottom = Math.min(...bounds.map((entry) => entry.bottom));
          if (left >= right || topEdge >= bottom) {
            throw new Error(`${stackId} cards do not overlap`);
          }
          return { x: (left + right) / 2, y: (topEdge + bottom) / 2 };
        };
        const common = intersection(Object.values(cardBounds));
        const hitOrder = {
          commonOverlap: idsAt(common.x, common.y),
          middleAndBaseOverlap: idsAt(
            common.x,
            (cardBounds.middle.top + cardBounds.top.top) / 2
          ),
          outermostBase: idsAt(
            common.x,
            (cardBounds.base.top + cardBounds.middle.top) / 2
          ),
        };

        cases.push({
          side,
          cards: stableCards,
          stack: {
            id: stackId,
            frameLocalBounds: rectOf(stableElement),
            topClientWidth: top.image.clientWidth,
            topLayer: top.image.layer ?? 0,
            preEvolution,
            transientResetClientWidth,
            transientResetAuthoredWidthPx,
            transientPostEvolution,
            stablePostRefresh,
            synchronousPostRefreshContainerCount,
            oldContainerConnectedImmediatelyAfterRefresh,
            stableContainerCount: zone.element.querySelectorAll(
              ':scope > .play-container'
            ).length,
            oldContainerConnected: oldContainer.isConnected,
            childDomOrder: [
              ...stableElement.querySelectorAll<HTMLImageElement>(
                ':scope > img'
              ),
            ].map(idOf),
            logicalOrder: stablePostRefresh.logicalOrder,
            hitOrder,
          },
        });
      }
    }
    return cases;
  });

  const frameTransforms = Object.fromEntries(
    Object.entries(layout.frameTransforms).map(([side, transform]) => [
      side,
      {
        ...transform,
        rotationDegrees:
          ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) % 360,
      },
    ])
  ) as RuntimeEvolutionCapture['frameTransforms'];
  const physicalRect = (
    side: EvolutionSide,
    bounds: EvolutionRect
  ): EvolutionRect => {
    const frame = layout.frames[side];
    return side === 'local'
      ? { ...bounds, x: frame.x + bounds.x, y: frame.y + bounds.y }
      : {
          ...bounds,
          x: frame.x + frame.width - bounds.x - bounds.width,
          y: frame.y + frame.height - bounds.y - bounds.height,
        };
  };
  return {
    frames: layout.frames,
    frameTransforms,
    cards: rawCases.flatMap(({ side, cards }) =>
      cards.map((card) => ({
        ...card,
        side,
        role: card.role === 'top' ? 'topEvolution' : 'lowerEvolution',
        physicalBounds: physicalRect(side, card.frameLocalBounds),
        effectiveRotationDegrees:
          (card.localRotationDegrees + frameTransforms[side].rotationDegrees) %
          360,
      }))
    ),
    stacks: rawCases.map(({ side, stack }) => ({
      ...stack,
      side,
      physicalBounds: physicalRect(side, stack.frameLocalBounds),
    })),
    sourceFulfillment: {
      servedPaths: loaded.servedPaths,
      blockedExternalOrigins: loaded.blockedOrigins,
      missingSameOriginPaths: loaded.missingPaths,
    },
  };
};
