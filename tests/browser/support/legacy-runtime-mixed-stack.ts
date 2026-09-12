import type { Page } from '@playwright/test';

import { captureLegacyRuntimeLayout } from './legacy-runtime-layout.js';
import { loadLegacyRuntime } from './legacy-runtime.js';

export type CapturedRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type CapturedPoint = { readonly x: number; readonly y: number };

export type LegacyMixedStackMovementSide = 'local' | 'opponent';
export type LegacyMixedStackMovementScenario =
  'nativeCanonical' | 'reverseRoundTrip' | 'categoryCycle';
export type LegacyMixedStackMovementRole =
  'base' | 'energy' | 'trainerTool' | 'controlBase';

export interface LegacyMixedStackMovementCard {
  readonly id: string;
  readonly side: LegacyMixedStackMovementSide;
  readonly role: LegacyMixedStackMovementRole;
  readonly currentCategory: 'Pokémon' | 'Energy' | 'Trainer';
  readonly originalCategory: 'Pokémon' | 'Energy' | 'Trainer' | null;
  readonly parentZone: 'active' | 'bench' | 'board';
  readonly parentStackId: string | null;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly untransformedPhysicalBounds: CapturedRect;
  readonly untransformedFrameLocalBounds: CapturedRect;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly logicalOrdinal: number;
  readonly domOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyMixedStackMovementPhase {
  readonly name: string;
  readonly mixedZone: 'active' | 'bench';
  readonly cards: readonly LegacyMixedStackMovementCard[];
  readonly zoneLogicalOrder: {
    readonly active: readonly string[];
    readonly bench: readonly string[];
    readonly board: readonly string[];
  };
  readonly zoneDirectDomOrder: {
    readonly active: readonly string[];
    readonly bench: readonly string[];
  };
  readonly wrapperCounts: { readonly active: number; readonly bench: number };
  readonly connectedWrapperIds: readonly string[];
  readonly stack: {
    readonly id: string;
    readonly side: LegacyMixedStackMovementSide;
    readonly physicalBounds: CapturedRect;
    readonly frameLocalBounds: CapturedRect;
    readonly baseClientWidth: number;
    readonly baseEnergyLayer: number;
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly inlineMarginRight: string;
    readonly computedMarginRightPx: number;
    readonly childDomOrder: readonly string[];
    readonly logicalOrder: readonly string[];
    readonly hitOrder: Readonly<Record<string, readonly string[]>>;
    readonly hitPointsFrameLocal: Readonly<Record<string, CapturedPoint>>;
    readonly hitPointsPhysical: Readonly<Record<string, CapturedPoint>>;
  };
}

export interface LegacyMixedStackMovementCase {
  readonly id: string;
  readonly side: LegacyMixedStackMovementSide;
  readonly scenario: LegacyMixedStackMovementScenario;
  readonly phases: readonly LegacyMixedStackMovementPhase[];
  readonly cleanup: {
    readonly observedWrapperCount: number;
    readonly observedCardCount: number;
    readonly sinkConnected: boolean;
  };
}

export interface LegacyRuntimeMixedStackMovementFixture {
  readonly frames: Readonly<Record<LegacyMixedStackMovementSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<
      LegacyMixedStackMovementSide,
      {
        readonly a: number;
        readonly b: number;
        readonly c: number;
        readonly d: number;
        readonly rotationDegrees: number;
      }
    >
  >;
  readonly cases: readonly LegacyMixedStackMovementCase[];
  readonly sourceFulfillment: {
    readonly servedPaths: readonly string[];
    readonly blockedExternalOrigins: readonly string[];
    readonly missingSameOriginPaths: readonly string[];
  };
}

type RawCard = Omit<
  LegacyMixedStackMovementCard,
  | 'side'
  | 'physicalBounds'
  | 'untransformedPhysicalBounds'
  | 'effectiveRotationDegrees'
>;

type RawPhase = Omit<LegacyMixedStackMovementPhase, 'cards' | 'stack'> & {
  readonly cards: readonly RawCard[];
  readonly stack: Omit<
    LegacyMixedStackMovementPhase['stack'],
    'side' | 'physicalBounds' | 'hitPointsPhysical'
  >;
};

type RawCase = Omit<LegacyMixedStackMovementCase, 'side' | 'phases'> & {
  readonly phases: readonly RawPhase[];
};

/**
 * Captures the complete mixed Energy/Tool movement oracle through v1 itself.
 *
 * Every state transition below calls the checked-in `Card`, `moveCardBundle`,
 * `changeType`, and `refreshBoard` exports. The helper only supplies cards and
 * takes observations; it deliberately contains no transcription of their
 * attachment, automatic slot movement, category, or reconstruction logic.
 */
export const captureLegacyRuntimeMixedStackMovementFixture = async (
  page: Page,
  options: { readonly retainStablePaint?: boolean } = {}
): Promise<LegacyRuntimeMixedStackMovementFixture> => {
  const loaded = await loadLegacyRuntime(page);
  const layout = await captureLegacyRuntimeLayout(page);
  const frames = layout.frames;
  const frameTransforms = Object.fromEntries(
    Object.entries(layout.frameTransforms).map(([side, matrix]) => [
      side,
      {
        ...matrix,
        rotationDegrees:
          ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360,
      },
    ])
  ) as LegacyRuntimeMixedStackMovementFixture['frameTransforms'];
  const rawCases: Array<{
    readonly side: LegacyMixedStackMovementSide;
    readonly value: RawCase;
  }> = [];

  for (const side of ['local', 'opponent'] as const) {
    const captured = await page.evaluate(
      async ({ user, side: caseSide, retainStablePaint }) => {
        const load = (specifier: string): Promise<Record<string, never>> =>
          import(/* @vite-ignore */ specifier);
        const [
          cardModule,
          zoneModule,
          bundleModule,
          changeTypeModule,
          placementModule,
          zoneActionsModule,
          refreshModule,
          resizerModule,
        ] = await Promise.all([
          load('/src/setup/deck-constructor/card.js'),
          load('/src/setup/zones/get-zone.js'),
          load('/src/actions/move-card-bundle/move-card-bundle.js'),
          load('/src/actions/general/change-type.js'),
          load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
          load('/src/actions/zones/general.js'),
          load('/src/setup/sizing/refresh-board.js'),
          load('/src/setup/sizing/resizer.js'),
        ]);

        type Category = 'Pokémon' | 'Energy' | 'Trainer';
        type ZoneName = 'active' | 'bench' | 'board' | 'hand';
        type Role = 'base' | 'energy' | 'trainerTool' | 'controlBase';
        interface LegacyImage extends HTMLImageElement {
          attached?: boolean;
          target?: string;
          relative?: HTMLImageElement | number;
          energyLayer?: number;
          layer?: number;
        }
        interface LegacyCard {
          readonly name: string;
          type: Category;
          type2?: Category;
          readonly image: LegacyImage;
        }
        interface LegacyZone {
          readonly element: HTMLElement;
          readonly array: LegacyCard[];
        }
        interface State {
          readonly scenario: string;
          readonly cards: readonly LegacyCard[];
          readonly byRole: Readonly<Record<Role, LegacyCard>>;
          readonly roleByImage: Map<HTMLImageElement, Role>;
          readonly wrapperIds: Map<HTMLElement, string>;
          nextWrapperId: number;
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
          readonly getZone: (owner: string, zoneId: string) => LegacyZone;
        };
        const { moveCardBundle } = bundleModule as unknown as {
          readonly moveCardBundle: (
            owner: string,
            initiator: string,
            origin: string,
            destination: string,
            index: number,
            targetIndex: number | undefined,
            action: string,
            emit?: boolean
          ) => void;
        };
        const { changeType } = changeTypeModule as unknown as {
          readonly changeType: (
            owner: string,
            initiator: string,
            zoneId: string,
            index: number,
            type: Category,
            emit?: boolean
          ) => void;
        };
        const { initializeActiveBenchCard } = placementModule as unknown as {
          readonly initializeActiveBenchCard: (
            owner: string,
            card: LegacyCard,
            zoneId: string,
            target: LegacyZone
          ) => void;
        };
        const { leaveAll } = zoneActionsModule as unknown as {
          readonly leaveAll: (
            owner: string,
            initiator: string,
            origin: string,
            destination: string,
            emit?: boolean
          ) => void;
        };
        const { refreshBoard } = refreshModule as unknown as {
          readonly refreshBoard: () => void;
        };
        const { adjustCards } = resizerModule as unknown as {
          readonly adjustCards: (
            owner: string,
            zoneId: string,
            ratio: number
          ) => void;
        };
        const zone = (id: ZoneName): LegacyZone => getZone(user, id);
        const twoFrames = () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        const rect = (bounds: DOMRect): CapturedRect => ({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
        const numeric = (value: string): number =>
          Number.parseFloat(value) || 0;
        const zoneForImage = (image: HTMLImageElement) => {
          for (const name of ['active', 'bench', 'board'] as const) {
            if (zone(name).element.contains(image)) return name;
          }
          return null;
        };
        const clearUser = () => {
          for (const id of [
            'active',
            'bench',
            'board',
            'hand',
            'attachedCards',
            'deck',
            'discard',
            'lostZone',
            'prizes',
            'viewCards',
          ]) {
            const target = getZone(user, id);
            target.array.length = 0;
            for (const image of [...target.element.querySelectorAll('img')]) {
              image.remove();
            }
            for (const wrapper of [
              ...target.element.querySelectorAll(':scope > .play-container'),
            ]) {
              wrapper.remove();
            }
          }
        };
        const make = async (
          scenario: string,
          role: Role,
          type: Category
        ): Promise<LegacyCard> => {
          const card = new Card(
            user,
            role,
            type,
            `${location.origin}/src/assets/cardback.png`
          );
          card.image.dataset.legacyMixedMovementCardId = `${caseSide}-${scenario}-${
            role === 'trainerTool'
              ? 'trainer-tool'
              : role === 'controlBase'
                ? 'control-base'
                : role
          }`;
          await card.image.decode();
          return card;
        };
        const newState = async (scenario: string): Promise<State> => {
          clearUser();
          await twoFrames();
          const base = await make(scenario, 'base', 'Pokémon');
          const energy = await make(scenario, 'energy', 'Energy');
          const trainerTool = await make(scenario, 'trainerTool', 'Trainer');
          const controlBase = await make(scenario, 'controlBase', 'Pokémon');
          const byRole = { base, energy, trainerTool, controlBase } as const;
          const entries = Object.entries(byRole) as [Role, LegacyCard][];
          return {
            scenario,
            cards: entries.map(([, card]) => card),
            byRole,
            roleByImage: new Map(
              entries.map(([role, card]) => [card.image, role])
            ),
            wrapperIds: new Map(),
            nextWrapperId: 0,
          };
        };
        const play = async (
          card: LegacyCard,
          destination: 'active' | 'bench',
          targetIndex = -1
        ) => {
          const hand = zone('hand');
          hand.array.push(card);
          hand.element.append(card.image);
          moveCardBundle(
            user,
            'self',
            'hand',
            destination,
            hand.array.length - 1,
            targetIndex,
            'play',
            false
          );
          await twoFrames();
        };
        const buildCanonical = async (state: State) => {
          await play(state.byRole.base, 'active');
          await play(
            state.byRole.energy,
            'active',
            zone('active').array.indexOf(state.byRole.base)
          );
          await play(
            state.byRole.trainerTool,
            'active',
            zone('active').array.indexOf(state.byRole.base)
          );
          await play(state.byRole.controlBase, 'bench');
          await Promise.all(
            state.cards.map((card) =>
              card.image.decode().catch(() => undefined)
            )
          );
          await twoFrames();
          refreshBoard();
          await twoFrames();
          adjustCards(user, 'active', 1);
          adjustCards(user, 'bench', 1);
          await twoFrames();
        };
        const buildReverse = async (state: State) => {
          const staged = getZone(user, 'attachedCards');
          for (const card of [
            state.byRole.base,
            state.byRole.trainerTool,
            state.byRole.energy,
          ]) {
            staged.array.push(card);
            staged.element.append(card.image);
          }
          await Promise.all(
            staged.array.map((card) =>
              card.image.decode().catch(() => undefined)
            )
          );
          staged.element.style.display = 'block';
          leaveAll(user, 'self', 'attachedCards', 'active', false);

          const bench = zone('bench');
          bench.array.push(state.byRole.controlBase);
          initializeActiveBenchCard(
            user,
            state.byRole.controlBase,
            'bench',
            bench
          );
          await state.byRole.controlBase.image.decode().catch(() => undefined);
          await twoFrames();
        };
        const wrapperId = (state: State, wrapper: HTMLElement): string => {
          const known = state.wrapperIds.get(wrapper);
          if (known) return known;
          const id = `${caseSide}-${state.scenario}-stack-${state.nextWrapperId}`;
          state.nextWrapperId += 1;
          state.wrapperIds.set(wrapper, id);
          wrapper.dataset.legacyMixedMovementStackId = id;
          return id;
        };
        const roleId = (state: State, image: HTMLImageElement): string => {
          const role = state.roleByImage.get(image);
          return role
            ? (state.byRole[role].image.dataset.legacyMixedMovementCardId ?? '')
            : '';
        };
        const snapshot = (state: State, name: string): RawPhase => {
          const active = zone('active');
          const bench = zone('bench');
          const board = zone('board');
          const base = state.byRole.base;
          const mixedZone = zoneForImage(base.image);
          if (mixedZone !== 'active' && mixedZone !== 'bench') {
            throw new Error('Real-v1 mixed base is not in a live slot');
          }
          const stack = base.image.parentElement;
          if (!stack) throw new Error('Real-v1 mixed base has no wrapper');
          const mixedStack = stack as HTMLElement;
          const allWrappers = [
            ...active.element.querySelectorAll<HTMLElement>(
              ':scope > .play-container'
            ),
            ...bench.element.querySelectorAll<HTMLElement>(
              ':scope > .play-container'
            ),
          ];
          for (const wrapper of allWrappers) wrapperId(state, wrapper);
          const paintedBounds = new Map(
            state.cards.map((card) => [
              card.image,
              card.image.getBoundingClientRect(),
            ])
          );
          const untransformedBounds = new Map<HTMLImageElement, DOMRect>();
          for (const card of state.cards) {
            const transform = card.image.style.transform;
            try {
              card.image.style.transform = 'none';
              untransformedBounds.set(
                card.image,
                card.image.getBoundingClientRect()
              );
            } finally {
              card.image.style.transform = transform;
            }
          }
          const baseBounds = paintedBounds.get(base.image);
          const energyBounds = paintedBounds.get(state.byRole.energy.image);
          const toolBounds = paintedBounds.get(state.byRole.trainerTool.image);
          const toolLayoutBounds = untransformedBounds.get(
            state.byRole.trainerTool.image
          );
          if (
            !baseBounds ||
            !energyBounds ||
            !toolBounds ||
            !toolLayoutBounds
          ) {
            throw new Error('Real-v1 mixed snapshot lacks card bounds');
          }
          const center = (bounds: {
            readonly left: number;
            readonly right: number;
            readonly top: number;
            readonly bottom: number;
          }): CapturedPoint => ({
            x: (bounds.left + bounds.right) / 2,
            y: (bounds.top + bounds.bottom) / 2,
          });
          const hitPointsFrameLocal = {
            baseOnly: center({
              left: baseBounds.left + 2,
              right: Math.min(energyBounds.left, toolBounds.left) - 2,
              top: baseBounds.top + 2,
              bottom: toolBounds.top - 2,
            }),
            allCardOverlap: center({
              left: Math.max(
                baseBounds.left,
                energyBounds.left,
                toolBounds.left
              ),
              right: Math.min(
                baseBounds.right,
                energyBounds.right,
                toolBounds.right
              ),
              top: Math.max(baseBounds.top, energyBounds.top, toolBounds.top),
              bottom: Math.min(
                baseBounds.bottom,
                energyBounds.bottom,
                toolBounds.bottom
              ),
            }),
            energyToolOverlap: center({
              left: baseBounds.right + 2,
              right: Math.min(energyBounds.right, toolBounds.right) - 2,
              top: Math.max(energyBounds.top, toolBounds.top),
              bottom: Math.min(energyBounds.bottom, toolBounds.bottom),
            }),
            toolPaintedOnly: center({
              left:
                Math.max(
                  baseBounds.right,
                  energyBounds.right,
                  toolLayoutBounds.right
                ) + 2,
              right: toolBounds.right - 2,
              top: toolBounds.top,
              bottom: toolBounds.bottom,
            }),
          };
          const idsAt = (point: CapturedPoint) =>
            base.image.ownerDocument
              .elementsFromPoint(point.x, point.y)
              .flatMap((element) => {
                const image = element.closest<HTMLImageElement>(
                  '[data-legacy-mixed-movement-card-id]'
                );
                const id = image?.dataset.legacyMixedMovementCardId;
                return id ? [id] : [];
              })
              .filter((id, index, ids) => ids.indexOf(id) === index);
          const directDomOrder = (target: LegacyZone) =>
            [
              ...target.element.querySelectorAll<HTMLImageElement>(
                ':scope > .play-container > img'
              ),
            ].map((image) => roleId(state, image));
          const stackStyles = getComputedStyle(mixedStack);
          return {
            name,
            mixedZone,
            cards: (Object.entries(state.byRole) as [Role, LegacyCard][]).map(
              ([role, card]) => {
                const painted = paintedBounds.get(card.image);
                const untransformed = untransformedBounds.get(card.image);
                const parentZone = zoneForImage(card.image);
                if (!painted || !untransformed || !parentZone) {
                  throw new Error(`Real-v1 mixed ${role} lacks snapshot state`);
                }
                const styles = getComputedStyle(card.image);
                const matrix =
                  styles.transform === 'none'
                    ? new DOMMatrixReadOnly()
                    : new DOMMatrixReadOnly(styles.transform);
                const parent = card.image.parentElement as HTMLElement | null;
                const logical = zone(parentZone).array;
                return {
                  id: card.image.dataset.legacyMixedMovementCardId ?? '',
                  role,
                  currentCategory: card.type,
                  originalCategory: card.type2 ?? null,
                  parentZone,
                  parentStackId: parent ? wrapperId(state, parent) : null,
                  frameLocalBounds: rect(painted),
                  untransformedFrameLocalBounds: rect(untransformed),
                  clientWidth: card.image.clientWidth,
                  clientHeight: card.image.clientHeight,
                  naturalWidth: card.image.naturalWidth,
                  naturalHeight: card.image.naturalHeight,
                  localRotationDegrees:
                    ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                    360,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  inlineLeftPx: numeric(card.image.style.left),
                  inlineBottomPx: numeric(card.image.style.bottom),
                  attached: Boolean(card.image.attached),
                  target: card.image.target ?? 'off',
                  relativeId:
                    card.image.relative instanceof HTMLImageElement
                      ? roleId(state, card.image.relative)
                      : null,
                  energyLayer: card.image.energyLayer ?? 0,
                  layer: card.image.layer ?? 0,
                  logicalOrdinal: logical.indexOf(card),
                  domOrdinal: parent
                    ? [...parent.querySelectorAll(':scope > img')].indexOf(
                        card.image
                      )
                    : -1,
                  sourcePath: new URL(
                    card.image.currentSrc || card.image.src,
                    location.href
                  ).pathname,
                };
              }
            ),
            zoneLogicalOrder: {
              active: active.array.map((card) => roleId(state, card.image)),
              bench: bench.array.map((card) => roleId(state, card.image)),
              board: board.array.map((card) => roleId(state, card.image)),
            },
            zoneDirectDomOrder: {
              active: directDomOrder(active),
              bench: directDomOrder(bench),
            },
            wrapperCounts: {
              active: active.element.querySelectorAll(
                ':scope > .play-container'
              ).length,
              bench: bench.element.querySelectorAll(':scope > .play-container')
                .length,
            },
            connectedWrapperIds: allWrappers.map((wrapper) =>
              wrapperId(state, wrapper)
            ),
            stack: {
              id: wrapperId(state, mixedStack),
              frameLocalBounds: rect(mixedStack.getBoundingClientRect()),
              baseClientWidth: base.image.clientWidth,
              baseEnergyLayer: base.image.energyLayer ?? 0,
              clientWidth: mixedStack.clientWidth,
              authoredWidthPx: numeric(mixedStack.style.width),
              inlineMarginRight: mixedStack.style.marginRight,
              computedMarginRightPx: numeric(stackStyles.marginRight),
              childDomOrder: [
                ...mixedStack.querySelectorAll<HTMLImageElement>(
                  ':scope > img'
                ),
              ].map((image) => roleId(state, image)),
              logicalOrder: zone(mixedZone)
                .array.filter(
                  (card) => card === base || card.image.relative === base.image
                )
                .map((card) => roleId(state, card.image)),
              hitOrder: Object.fromEntries(
                Object.entries(hitPointsFrameLocal).map(([label, point]) => [
                  label,
                  idsAt(point),
                ])
              ),
              hitPointsFrameLocal,
            },
          };
        };
        const cleanup = async (state: State) => {
          clearUser();
          await twoFrames();
          const active = zone('active');
          const bench = zone('bench');
          return {
            observedWrapperCount:
              active.element.querySelectorAll(':scope > .play-container')
                .length +
              bench.element.querySelectorAll(':scope > .play-container').length,
            observedCardCount: active.element.ownerDocument.querySelectorAll(
              '[data-legacy-mixed-movement-card-id]'
            ).length,
            sinkConnected: state.cards.some((card) => card.image.isConnected),
          };
        };
        const moveRoundTripToBench = (state: State) => {
          moveCardBundle(
            user,
            'self',
            'active',
            'bench',
            zone('active').array.indexOf(state.byRole.base),
            undefined,
            'move',
            false
          );
        };
        const moveRoundTripToActive = (state: State) => {
          moveCardBundle(
            user,
            'self',
            'bench',
            'active',
            zone('bench').array.indexOf(state.byRole.base),
            zone('active').array.indexOf(state.byRole.controlBase),
            'move',
            false
          );
        };

        const cases: RawCase[] = [];
        {
          const state = await newState('native-canonical');
          await buildCanonical(state);
          cases.push({
            id: `${caseSide}-native-canonical`,
            scenario: 'nativeCanonical',
            phases: [snapshot(state, 'stableCanonicalActive')],
            cleanup: await cleanup(state),
          });
        }
        {
          const state = await newState('reverse-round-trip');
          await buildReverse(state);
          const phases: RawPhase[] = [
            snapshot(state, 'initialReverseRestoredActive'),
          ];
          moveRoundTripToBench(state);
          phases.push(snapshot(state, 'immediateCanonicalBench'));
          await twoFrames();
          phases.push(snapshot(state, 'settledCanonicalBench'));
          moveRoundTripToActive(state);
          phases.push(snapshot(state, 'immediateCanonicalActiveReturn'));
          await twoFrames();
          phases.push(snapshot(state, 'settledCanonicalActiveReturn'));
          cases.push({
            id: `${caseSide}-reverse-round-trip`,
            scenario: 'reverseRoundTrip',
            phases,
            cleanup: await cleanup(state),
          });
        }
        {
          const state = await newState('category-cycle');
          await buildCanonical(state);
          const phases: RawPhase[] = [
            snapshot(state, 'initialCanonicalActive'),
          ];
          changeType(
            user,
            'self',
            'active',
            zone('active').array.indexOf(state.byRole.energy),
            'Trainer',
            false
          );
          await twoFrames();
          changeType(
            user,
            'self',
            'board',
            zone('board').array.indexOf(state.byRole.energy),
            'Energy',
            false
          );
          await twoFrames();
          moveCardBundle(
            user,
            'self',
            'board',
            'active',
            zone('board').array.indexOf(state.byRole.energy),
            zone('active').array.indexOf(state.byRole.base),
            'play',
            false
          );
          await twoFrames();
          changeType(
            user,
            'self',
            'active',
            zone('active').array.indexOf(state.byRole.trainerTool),
            'Energy',
            false
          );
          await twoFrames();
          changeType(
            user,
            'self',
            'board',
            zone('board').array.indexOf(state.byRole.trainerTool),
            'Trainer',
            false
          );
          await twoFrames();
          const board = zone('board');
          moveCardBundle(
            user,
            'self',
            'board',
            'active',
            board.array.indexOf(state.byRole.trainerTool),
            zone('active').array.indexOf(state.byRole.base),
            'play',
            false
          );
          phases.push(snapshot(state, 'immediateCanonicalAfterCategoryCycle'));
          await twoFrames();
          phases.push(snapshot(state, 'settledCanonicalAfterCategoryCycle'));
          cases.push({
            id: `${caseSide}-category-cycle`,
            scenario: 'categoryCycle',
            phases,
            cleanup: await cleanup(state),
          });
        }
        if (retainStablePaint) {
          const state = await newState('reverse-round-trip');
          await buildReverse(state);
          moveRoundTripToBench(state);
          await twoFrames();
          moveRoundTripToActive(state);
          await twoFrames();
        }
        return cases;
      },
      {
        user: side === 'local' ? 'self' : 'opp',
        side,
        retainStablePaint: options.retainStablePaint ?? false,
      }
    );
    rawCases.push(...captured.map((value) => ({ side, value })));
  }

  const physicalRect = (
    side: LegacyMixedStackMovementSide,
    bounds: CapturedRect
  ): CapturedRect =>
    side === 'local'
      ? {
          x: frames.local.x + bounds.x,
          y: frames.local.y + bounds.y,
          width: bounds.width,
          height: bounds.height,
        }
      : {
          x:
            frames.opponent.x + frames.opponent.width - bounds.x - bounds.width,
          y:
            frames.opponent.y +
            frames.opponent.height -
            bounds.y -
            bounds.height,
          width: bounds.width,
          height: bounds.height,
        };
  const physicalPoint = (
    side: LegacyMixedStackMovementSide,
    point: CapturedPoint
  ): CapturedPoint =>
    side === 'local'
      ? { x: frames.local.x + point.x, y: frames.local.y + point.y }
      : {
          x: frames.opponent.x + frames.opponent.width - point.x,
          y: frames.opponent.y + frames.opponent.height - point.y,
        };
  const cases = rawCases.map(
    ({ side, value }): LegacyMixedStackMovementCase => ({
      ...value,
      side,
      phases: value.phases.map((phase) => ({
        ...phase,
        cards: phase.cards.map((card) => ({
          ...card,
          side,
          physicalBounds: physicalRect(side, card.frameLocalBounds),
          untransformedPhysicalBounds: physicalRect(
            side,
            card.untransformedFrameLocalBounds
          ),
          effectiveRotationDegrees:
            (card.localRotationDegrees +
              frameTransforms[side].rotationDegrees) %
            360,
        })),
        stack: {
          ...phase.stack,
          side,
          physicalBounds: physicalRect(side, phase.stack.frameLocalBounds),
          hitPointsPhysical: Object.fromEntries(
            Object.entries(phase.stack.hitPointsFrameLocal).map(
              ([label, point]) => [label, physicalPoint(side, point)]
            )
          ),
        },
      })),
    })
  );

  return {
    frames,
    frameTransforms,
    cases,
    sourceFulfillment: {
      servedPaths: loaded.servedPaths,
      blockedExternalOrigins: loaded.blockedOrigins,
      missingSameOriginPaths: loaded.missingPaths,
    },
  };
};
