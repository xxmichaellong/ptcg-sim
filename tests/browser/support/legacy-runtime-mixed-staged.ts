import type { Page } from '@playwright/test';

import type { Rect, ReflowSide } from './legacy-runtime-attachment-reflow.js';

export type MixedStagedRole =
  | 'base'
  | 'energyOne'
  | 'energyTwo'
  | 'trainerToolOne'
  | 'trainerToolTwo'
  | 'deckTopTrainerTool'
  | 'deckRemainderEnergy';

export type MixedStagedScenario =
  'reverseTwo' | 'interleavedFour' | 'stagedSwap';

export interface MixedStagedCardState {
  readonly id: string;
  readonly role: MixedStagedRole;
  readonly currentCategory: 'Pokémon' | 'Energy' | 'Trainer';
  readonly parentZone: 'attachedCards' | 'deck';
  readonly logicalOrdinal: number;
  readonly domOrdinal: number;
  readonly localRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeRole: MixedStagedRole | null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly sourcePath: string;
}

export interface MixedStagedZoneSnapshot {
  readonly cards: readonly MixedStagedCardState[];
  readonly logicalRoles: readonly MixedStagedRole[];
  readonly domRoles: readonly MixedStagedRole[];
  readonly display: string;
}

export interface MixedRestoredCard {
  readonly role: MixedStagedRole;
  readonly frameLocalBounds: Rect;
  readonly untransformedFrameLocalBounds: Rect;
  readonly localRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeRole: MixedStagedRole | null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly domOrdinal: number;
  readonly logicalOrdinal: number;
}

export interface MixedRestoredSnapshot {
  readonly cards: readonly MixedRestoredCard[];
  readonly observedWrapperCount: number;
  readonly stagingDisplay: string;
  readonly stack: {
    readonly frameLocalBounds: Rect;
    readonly baseClientWidth: number;
    readonly baseEnergyLayer: number;
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly inlineMarginRight: string;
    readonly computedMarginRightPx: number;
    readonly domRoles: readonly MixedStagedRole[];
    readonly logicalRoles: readonly MixedStagedRole[];
    readonly roleHitOrder: Readonly<Record<string, readonly MixedStagedRole[]>>;
  };
}

export interface MixedStagedHistoryCapture {
  readonly stagedBefore: MixedStagedZoneSnapshot;
  readonly deckBefore: MixedStagedZoneSnapshot | null;
  readonly stagedAfterSwap: MixedStagedZoneSnapshot | null;
  readonly deckAfterSwap: MixedStagedZoneSnapshot | null;
  readonly selectedRole: MixedStagedRole | null;
  readonly priorDeckTopRole: MixedStagedRole | null;
  readonly immediatePostRestore: MixedRestoredSnapshot;
  readonly settledPostRestore: MixedRestoredSnapshot;
  readonly cleanup: {
    readonly observedWrapperCount: number;
    readonly observedCardCount: number;
    readonly stagingDisplay: string;
  };
}

/**
 * Drives v1's real staged-card restoration and deck-top swap paths.
 *
 * The staged popup contents are the input state, so real `Card` instances are
 * installed in the real zone arrays and DOM before invoking `leaveAll` or
 * `switchWithDeckTop`. No attachment, reset, movement, or layout rule is
 * reproduced here: every transition after setup is owned by the v1 modules.
 */
export const captureMixedStagedHistory = async (
  page: Page,
  options: {
    readonly side: ReflowSide;
    readonly scenario: MixedStagedScenario;
    readonly prefix: string;
  }
): Promise<MixedStagedHistoryCapture> =>
  page.evaluate(
    async ({ user, scenario, prefix }) => {
      const load = (specifier: string): Promise<Record<string, never>> =>
        import(/* @vite-ignore */ specifier);
      const [cardModule, zoneModule, generalModule, deckModule] =
        await Promise.all([
          load('/src/setup/deck-constructor/card.js'),
          load('/src/setup/zones/get-zone.js'),
          load('/src/actions/zones/general.js'),
          load('/src/actions/zones/deck-actions.js'),
        ]);

      interface LegacyImage extends HTMLImageElement {
        energyLayer?: number;
        layer?: number;
        attached?: boolean;
        target?: string;
        relative?: HTMLImageElement | number;
      }
      interface LegacyCard {
        readonly name: string;
        readonly type: string;
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
      const { leaveAll } = generalModule as unknown as {
        readonly leaveAll: (
          user: string,
          initiator: string,
          originZoneId: string,
          destinationZoneId: string,
          emit: boolean
        ) => void;
      };
      const { switchWithDeckTop } = deckModule as unknown as {
        readonly switchWithDeckTop: (
          user: string,
          initiator: string,
          originZoneId: string,
          index: number,
          emit: boolean
        ) => void;
      };

      const clearZone = (owner: string, zoneId: string): void => {
        const zone = getZone(owner, zoneId);
        zone.array.length = 0;
        for (const image of [...zone.element.querySelectorAll('img')]) {
          const parent = image.parentElement;
          image.remove();
          if (parent?.classList.contains('play-container')) parent.remove();
        }
      };
      for (const owner of ['self', 'opp']) {
        for (const zoneId of [
          'active',
          'bench',
          'hand',
          'deck',
          'discard',
          'attachedCards',
        ]) {
          clearZone(owner, zoneId);
        }
      }

      const active = getZone(user, 'active');
      const staged = getZone(user, 'attachedCards');
      const deck = getZone(user, 'deck');
      const typeFor = (
        role: MixedStagedRole
      ): 'Pokémon' | 'Energy' | 'Trainer' => {
        if (role === 'base') return 'Pokémon';
        return role.toLowerCase().includes('energy') ? 'Energy' : 'Trainer';
      };
      const idFor = (role: MixedStagedRole): string =>
        `${prefix}-${role.replace(/([A-Z])/gu, '-$1').toLowerCase()}`;
      const stagedRoles: readonly MixedStagedRole[] =
        scenario === 'reverseTwo'
          ? ['base', 'trainerToolOne', 'energyOne']
          : [
              'base',
              'trainerToolOne',
              'energyOne',
              'trainerToolTwo',
              'energyTwo',
            ];
      const deckRoles: readonly MixedStagedRole[] =
        scenario === 'stagedSwap'
          ? ['deckTopTrainerTool', 'deckRemainderEnergy']
          : [];
      const allRoles = [...stagedRoles, ...deckRoles];
      const byRole = new Map<MixedStagedRole, LegacyCard>();
      const byImage = new Map<LegacyImage, MixedStagedRole>();

      for (const role of allRoles) {
        const card = new Card(
          user,
          role,
          typeFor(role),
          `${location.origin}/src/assets/cardback.png`
        );
        card.image.dataset.legacyRuntimeMixedStagedId = idFor(role);
        byRole.set(role, card);
        byImage.set(card.image, role);
        const zone = deckRoles.includes(role) ? deck : staged;
        zone.array.push(card);
        zone.element.append(card.image);
      }
      await Promise.all(
        [...byRole.values()].map((card) => card.image.decode())
      );
      staged.element.style.display = 'block';

      const numeric = (value: string): number => Number.parseFloat(value) || 0;
      const rotation = (image: LegacyImage): number => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
        return ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360;
      };
      const roleOf = (image: LegacyImage): MixedStagedRole => {
        const role = byImage.get(image);
        if (!role)
          throw new Error('Real-v1 staged history contains an unknown card');
        return role;
      };
      const directImages = (zone: LegacyZone): readonly LegacyImage[] =>
        [
          ...zone.element.querySelectorAll<HTMLImageElement>(':scope > img'),
        ].filter((image): image is LegacyImage =>
          byImage.has(image as LegacyImage)
        );
      const snapshotZone = (zone: LegacyZone): MixedStagedZoneSnapshot => {
        const dom = directImages(zone);
        const logical = zone.array.filter((card) => byImage.has(card.image));
        return {
          cards: logical.map((card, logicalOrdinal) => {
            const role = roleOf(card.image);
            const parentZone =
              card.image.parentElement === staged.element
                ? 'attachedCards'
                : card.image.parentElement === deck.element
                  ? 'deck'
                  : null;
            if (!parentZone) {
              throw new Error(`Real-v1 staged ${role} has an invalid parent`);
            }
            return {
              id: card.image.dataset.legacyRuntimeMixedStagedId ?? '',
              role,
              currentCategory: typeFor(role),
              parentZone,
              logicalOrdinal,
              domOrdinal: dom.indexOf(card.image),
              localRotationDegrees: rotation(card.image),
              zIndex: Number.parseInt(card.image.style.zIndex, 10) || 0,
              inlineLeftPx: numeric(card.image.style.left),
              inlineBottomPx: numeric(card.image.style.bottom),
              attached: card.image.attached === true,
              target: card.image.target ?? '',
              relativeRole:
                typeof card.image.relative === 'object' &&
                card.image.relative !== null
                  ? (byImage.get(card.image.relative) ?? null)
                  : null,
              energyLayer: card.image.energyLayer ?? 0,
              layer: card.image.layer ?? 0,
              sourcePath: new URL(card.image.currentSrc).pathname,
            };
          }),
          logicalRoles: logical.map((card) => roleOf(card.image)),
          domRoles: dom.map(roleOf),
          display: getComputedStyle(zone.element).display,
        };
      };

      const rectOf = (element: Element): Rect => {
        const bounds = element.getBoundingClientRect();
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      };
      const snapshotRestored = (): MixedRestoredSnapshot => {
        const base = byRole.get('base');
        const stack = base?.image.parentElement;
        if (!base || !stack?.classList.contains('play-container')) {
          throw new Error('Real-v1 staged history did not restore its base');
        }
        stack.dataset.legacyRuntimeMixedStagedStack = prefix;
        const domImages = [
          ...stack.querySelectorAll<HTMLImageElement>(':scope > img'),
        ].filter((image): image is LegacyImage =>
          byImage.has(image as LegacyImage)
        );
        const logical = active.array.filter(
          (card) => card.image.parentElement === stack
        );
        const painted = new Map(
          logical.map((card) => [
            card.image,
            card.image.getBoundingClientRect(),
          ])
        );
        const untransformed = new Map<LegacyImage, Rect>();
        for (const card of logical) {
          const transform = card.image.style.transform;
          try {
            card.image.style.transform = 'none';
            untransformed.set(card.image, rectOf(card.image));
          } finally {
            card.image.style.transform = transform;
          }
        }
        const bounds = [...painted.values()];
        if (bounds.length === 0) {
          throw new Error('Real-v1 restored stack contains no cards');
        }
        const points: Record<string, { x: number; y: number }> = {
          commonOverlap: {
            x:
              (Math.max(...bounds.map((value) => value.left)) +
                Math.min(...bounds.map((value) => value.right))) /
              2,
            y:
              (Math.max(...bounds.map((value) => value.top)) +
                Math.min(...bounds.map((value) => value.bottom))) /
              2,
          },
        };
        for (const card of logical) {
          const cardBounds = painted.get(card.image)!;
          points[`center-${roleOf(card.image)}`] = {
            x: (cardBounds.left + cardBounds.right) / 2,
            y: (cardBounds.top + cardBounds.bottom) / 2,
          };
        }
        const rightmost = logical.reduce((selected, card) =>
          painted.get(card.image)!.right > painted.get(selected.image)!.right
            ? card
            : selected
        );
        const rightmostBounds = painted.get(rightmost.image)!;
        points['rightmostPaint'] = {
          x: rightmostBounds.right - 2,
          y: (rightmostBounds.top + rightmostBounds.bottom) / 2,
        };
        const known = new Set(domImages);
        const rolesAt = (point: { readonly x: number; readonly y: number }) =>
          stack.ownerDocument
            .elementsFromPoint(point.x, point.y)
            .flatMap((candidate) => {
              const image = candidate.closest<HTMLImageElement>(
                '[data-legacy-runtime-mixed-staged-id]'
              ) as LegacyImage | null;
              return image && known.has(image) ? [roleOf(image)] : [];
            })
            .filter((role, index, roles) => roles.indexOf(role) === index);
        const stackStyles = getComputedStyle(stack);
        return {
          cards: logical.map((card, logicalOrdinal) => {
            const cardBounds = painted.get(card.image);
            const plainBounds = untransformed.get(card.image);
            if (!cardBounds || !plainBounds) {
              throw new Error('Real-v1 restored card lost its geometry');
            }
            return {
              role: roleOf(card.image),
              frameLocalBounds: {
                x: cardBounds.x,
                y: cardBounds.y,
                width: cardBounds.width,
                height: cardBounds.height,
              },
              untransformedFrameLocalBounds: plainBounds,
              localRotationDegrees: rotation(card.image),
              zIndex: Number.parseInt(card.image.style.zIndex, 10) || 0,
              inlineLeftPx: numeric(card.image.style.left),
              attached: card.image.attached === true,
              target: card.image.target ?? '',
              relativeRole:
                typeof card.image.relative === 'object' &&
                card.image.relative !== null
                  ? (byImage.get(card.image.relative) ?? null)
                  : null,
              energyLayer: card.image.energyLayer ?? 0,
              layer: card.image.layer ?? 0,
              domOrdinal: domImages.indexOf(card.image),
              logicalOrdinal,
            };
          }),
          observedWrapperCount: active.element.querySelectorAll(
            ':scope > .play-container'
          ).length,
          stagingDisplay: getComputedStyle(staged.element).display,
          stack: {
            frameLocalBounds: rectOf(stack),
            baseClientWidth: base.image.clientWidth,
            baseEnergyLayer: base.image.energyLayer ?? 0,
            clientWidth: stack.clientWidth,
            authoredWidthPx: numeric((stack as HTMLElement).style.width),
            inlineMarginRight: (stack as HTMLElement).style.marginRight,
            computedMarginRightPx: numeric(stackStyles.marginRight),
            domRoles: domImages.map(roleOf),
            logicalRoles: logical.map((card) => roleOf(card.image)),
            roleHitOrder: Object.fromEntries(
              Object.entries(points).map(([label, point]) => [
                label,
                rolesAt(point),
              ])
            ),
          },
        };
      };

      const frames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      const stagedBefore = snapshotZone(staged);
      const deckBefore = scenario === 'stagedSwap' ? snapshotZone(deck) : null;
      let stagedAfterSwap: MixedStagedZoneSnapshot | null = null;
      let deckAfterSwap: MixedStagedZoneSnapshot | null = null;
      let selectedRole: MixedStagedRole | null = null;
      let priorDeckTopRole: MixedStagedRole | null = null;
      if (scenario === 'stagedSwap') {
        selectedRole = 'energyOne';
        priorDeckTopRole = roleOf(deck.array[0]!.image);
        const selectedIndex = staged.array.findIndex(
          (card) => roleOf(card.image) === selectedRole
        );
        switchWithDeckTop(user, 'self', 'attachedCards', selectedIndex, false);
        await Promise.all(
          [...byRole.values()].map((card) =>
            card.image.decode().catch(() => undefined)
          )
        );
        stagedAfterSwap = snapshotZone(staged);
        deckAfterSwap = snapshotZone(deck);
      }

      leaveAll(user, 'self', 'attachedCards', 'active', false);
      const immediatePostRestore = snapshotRestored();
      await frames();
      const settledPostRestore = snapshotRestored();

      for (const zoneId of ['active', 'attachedCards', 'deck']) {
        clearZone(user, zoneId);
      }
      await frames();
      return {
        stagedBefore,
        deckBefore,
        stagedAfterSwap,
        deckAfterSwap,
        selectedRole,
        priorDeckTopRole,
        immediatePostRestore,
        settledPostRestore,
        cleanup: {
          observedWrapperCount: active.element.querySelectorAll(
            ':scope > .play-container'
          ).length,
          observedCardCount: active.element.ownerDocument.querySelectorAll(
            '[data-legacy-runtime-mixed-staged-id]'
          ).length,
          stagingDisplay: getComputedStyle(staged.element).display,
        },
      };
    },
    {
      user: options.side === 'local' ? 'self' : 'opp',
      scenario: options.scenario,
      prefix: options.prefix,
    }
  );
