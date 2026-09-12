import type { Page } from '@playwright/test';

export type ReflowSide = 'local' | 'opponent';
export type ReflowSlot = 'active' | 'bench';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FrameTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly rotationDegrees: number;
}

/** One card placed by the replay, measured in its own frame's coordinates. */
export interface ReflowCard {
  readonly id: string;
  readonly role: string;
  readonly frameLocalBounds: Rect;
  readonly untransformedFrameLocalBounds: Rect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly inlineLeft: string;
  readonly inlineBottom: string;
  readonly inlineTransform: string;
  readonly localRotationDegrees: number;
  readonly zIndex: string;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly computedWidthPx: number;
  readonly computedHeightPx: number;
  readonly transformMatrix: {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
  };
  readonly transformOrigin: string;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeRole: string | null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly domOrdinal: number;
  readonly sourcePath: string;
}

export interface ReflowStack {
  readonly id: string;
  readonly frameLocalBounds: Rect;
  readonly baseClientWidth: number;
  readonly clientWidth: number;
  readonly authoredWidthPx: number;
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly childDomOrder: readonly string[];
  readonly logicalOrder: readonly string[];
  readonly hitOrder: {
    readonly commonOverlap: readonly string[];
    readonly attachmentOnly: readonly string[];
    readonly baseOnly: readonly string[];
    readonly authoredLayoutOnly: readonly string[];
  };
  readonly hitPointsFrameLocal: {
    readonly commonOverlap: { readonly x: number; readonly y: number } | null;
    readonly attachmentOnly: { readonly x: number; readonly y: number } | null;
    readonly baseOnly: { readonly x: number; readonly y: number } | null;
    readonly authoredLayoutOnly: {
      readonly x: number;
      readonly y: number;
    } | null;
  };
}

export interface ReflowAttachmentBoundary {
  readonly transientPostAttach: {
    readonly logicalOrder: readonly string[];
    readonly domOrder: readonly string[];
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly inlineMarginRight: string;
    readonly computedMarginRightPx: number;
  };
  readonly synchronousPostRefreshContainerCount: number;
  readonly oldContainerConnectedImmediatelyAfterRefresh: boolean;
  readonly stableContainerCount: number;
  readonly oldContainerConnected: boolean;
}

export interface ReflowCapture {
  readonly cards: readonly ReflowCard[];
  readonly stack: ReflowStack;
  /** Container width after each attachment, before the next one lands. */
  readonly attachmentClientWidthsBefore: readonly number[];
  readonly attachmentAuthoredWidthsPx: readonly number[];
  readonly attachmentBoundary: ReflowAttachmentBoundary | null;
}

/** The v1 card type each fixture role is constructed with. */
const CARD_TYPE_BY_ROLE: Readonly<Record<string, string>> = {
  base: 'Pokémon',
  middle: 'Pokémon',
  top: 'Pokémon',
  energy: 'Energy',
  energy1: 'Energy',
  energy2: 'Energy',
  tool: 'Trainer',
  'trainer-as-tool': 'Trainer',
};

/**
 * Builds a stack through v1's real `moveCardBundle` and measures the result.
 *
 * The reflow fixtures record the `moveCardBundle -> moveCard -> attachCard ->
 * refreshBoard` path by name, so the replay drives that path rather than
 * calling `attachCard` directly: the container's width is recomputed by the
 * refresh each move performs, and attaching without it measures a stack that
 * has not reflowed yet.
 *
 * Geometry comes back in the acting frame's own coordinates. Both players'
 * boards are laid out identically inside their frames and the opponent frame is
 * rotated 180 degrees as a whole, so frame-local figures are directly
 * comparable between sides while physical ones are not.
 */
export const captureReflow = async (
  page: Page,
  options: {
    readonly side: ReflowSide;
    readonly slot: ReflowSlot;
    /** Pokemon placed and evolved onto each other, in order. */
    readonly evolutionOrder: readonly string[];
    /** Non-Pokemon attached to the base, in order. */
    readonly attachmentOrder: readonly string[];
    /** Stable card IDs used by paint and hit-order comparisons. */
    readonly cardIdsByRole?: Readonly<Record<string, string>>;
    readonly stackId?: string;
    /** Split the final attachment's move and refresh to sample that boundary. */
    readonly captureAttachmentBoundary?: boolean;
    /** Keep the other player's settled stack for a combined paint capture. */
    readonly preserveOtherSide?: boolean;
  }
): Promise<ReflowCapture> =>
  page.evaluate(
    async ({
      user,
      zoneId,
      evolutionOrder,
      attachmentOrder,
      typeByRole,
      cardIdsByRole,
      stackId,
      captureAttachmentBoundary,
      preserveOtherSide,
    }) => {
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
        relative?: HTMLImageElement | number;
        energyLayer?: number;
        layer?: number;
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
          oZoneId: string,
          dZoneId: string,
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
          oZoneId: string,
          dZoneId: string,
          index: number,
          targetIndex: number
        ) => void;
      };
      const { refreshBoard } = refreshModule as unknown as {
        readonly refreshBoard: () => void;
      };

      // Both sides are normally cleared, not just the acting one. `refreshBoard`
      // rebuilds the whole board, so a stack left behind by an earlier capture
      // on the other side takes part in this one's reflow. Combined source-paint
      // fixtures can explicitly preserve that already-settled opposite stack.
      //
      // Only cards are removed, never the element's other children: a zone
      // container also holds v1's own controls, and `sort` reads the discard
      // zone's sort checkbox out of it.
      const clearZone = (owner: string, id: string) => {
        const target = getZone(owner, id);
        target.array.length = 0;
        for (const image of [...target.element.querySelectorAll('img')]) {
          const parent = image.parentElement;
          image.remove();
          if (parent?.classList.contains('play-container')) parent.remove();
        }
      };
      for (const owner of preserveOtherSide ? [user] : ['self', 'opp']) {
        for (const id of ['active', 'bench', 'hand', 'discard']) {
          clearZone(owner, id);
        }
      }
      const zone = getZone(user, zoneId);
      const hand = getZone(user, 'hand');

      const frames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      const make = async (name: string): Promise<LegacyCard> => {
        const card = new Card(
          user,
          name,
          typeByRole[name] ?? 'Pokémon',
          `${location.origin}/src/assets/cardback.png`
        );
        card.image.dataset.legacyRuntimeReflowCardId =
          cardIdsByRole[name] ?? name;
        await card.image.decode();
        return card;
      };
      /** Plays one card from hand; `targetIndex` of -1 means "no target". */
      const play = async (card: LegacyCard, targetIndex: number) => {
        hand.array.push(card);
        hand.element.append(card.image);
        moveCardBundle(
          user,
          'self',
          'hand',
          zoneId,
          hand.array.length - 1,
          targetIndex,
          'play',
          false
        );
        await frames();
      };
      const indexOf = (name: string) =>
        zone.array.findIndex((card) => card.name === name);

      const byRole = new Map<string, LegacyCard>();
      const [first, ...evolutions] = evolutionOrder;
      const base = await make(first!);
      byRole.set(first!, base);
      await play(base, -1);
      let host = first!;
      for (const role of evolutions) {
        const card = await make(role);
        byRole.set(role, card);
        await play(card, indexOf(host));
        host = role;
      }

      const container = (): HTMLElement => {
        const element = byRole.get(first!)?.image.parentElement;
        if (!element) {
          throw new Error('Real-v1 reflow base has no play container');
        }
        element.dataset.legacyRuntimeReflowStackId = stackId;
        return element;
      };

      /**
       * Refreshes until the container's width stops changing.
       *
       * `evolveCard` and `attachCard` size the container from images that have
       * not been laid out yet, so a stack built in one synchronous burst starts
       * zero-width and the first refresh after it can still measure zero. In a
       * live session every later action refreshes the board again and settles
       * it; this reproduces that instead of assuming one refresh is enough.
       */
      const settle = async (): Promise<void> => {
        let previous = '';
        for (let attempt = 0; attempt < 16; attempt += 1) {
          refreshBoard();
          await frames();
          const images = [...container().querySelectorAll('img')];
          await Promise.all(
            images.map((image) =>
              image.complete && image.naturalWidth > 0
                ? Promise.resolve()
                : image.decode()
            )
          );
          // A cached image can finish decoding between style/layout passes.
          // Give Chromium one more paint before deciding the source runtime is
          // stable, then require the entire card geometry signature—not only
          // the wrapper width—to agree across two refreshes.
          await frames();
          const element = container();
          const signature = JSON.stringify({
            width: element.clientWidth,
            cards: images.map((image) => {
              const bounds = image.getBoundingClientRect();
              return [
                image.clientWidth,
                image.clientHeight,
                image.naturalWidth,
                image.naturalHeight,
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
              ];
            }),
          });
          const ready =
            element.clientWidth > 0 &&
            images.length > 0 &&
            images.every((image) => {
              const bounds = image.getBoundingClientRect();
              return (
                image.complete &&
                image.naturalWidth > 0 &&
                image.naturalHeight > 0 &&
                image.clientWidth > 0 &&
                image.clientHeight > 0 &&
                bounds.width > 0 &&
                bounds.height > 0
              );
            });
          if (ready && signature === previous) return;
          previous = signature;
        }
        throw new Error('Real-v1 play container never settled its card layout');
      };

      // The fixtures record an attachment landing on a settled stack, so the
      // "before" measurement is taken against one.
      await settle();

      const attachmentClientWidthsBefore: number[] = [];
      const attachmentAuthoredWidthsPx: number[] = [];
      let attachmentBoundary: ReflowAttachmentBoundary | null = null;
      if (captureAttachmentBoundary && attachmentOrder.length !== 1) {
        throw new Error(
          'Attachment-boundary capture requires exactly one attachment'
        );
      }
      for (const role of attachmentOrder) {
        attachmentClientWidthsBefore.push(container().clientWidth);
        const card = await make(role);
        byRole.set(role, card);
        // Attachments always target the stack's own base, which is where v1
        // anchors an Energy or Tool regardless of how tall the stack is.
        if (captureAttachmentBoundary) {
          hand.array.push(card);
          hand.element.append(card.image);
          const oldContainer = container();
          moveCard(
            user,
            'self',
            'hand',
            zoneId,
            hand.array.length - 1,
            indexOf(first!)
          );
          const transientContainer = container();
          attachmentAuthoredWidthsPx.push(
            Number.parseFloat(transientContainer.style.width)
          );
          const transientPostAttach = {
            logicalOrder: zone.array.map(({ name }) => name),
            domOrder: [
              ...transientContainer.querySelectorAll(':scope > img'),
            ].map((image) => {
              for (const [candidateRole, candidate] of byRole) {
                if (candidate.image === image) return candidateRole;
              }
              return 'unknown';
            }),
            clientWidth: transientContainer.clientWidth,
            authoredWidthPx: Number.parseFloat(transientContainer.style.width),
            inlineMarginRight: transientContainer.style.marginRight,
            computedMarginRightPx:
              Number.parseFloat(
                getComputedStyle(transientContainer).marginRight
              ) || 0,
          };
          refreshBoard();
          const synchronousPostRefreshContainerCount =
            zone.element.querySelectorAll(':scope > .play-container').length;
          const oldContainerConnectedImmediatelyAfterRefresh =
            oldContainer.isConnected;
          await frames();
          attachmentBoundary = {
            transientPostAttach,
            synchronousPostRefreshContainerCount,
            oldContainerConnectedImmediatelyAfterRefresh,
            stableContainerCount: zone.element.querySelectorAll(
              ':scope > .play-container'
            ).length,
            oldContainerConnected: oldContainer.isConnected,
          };
        } else {
          await play(card, indexOf(first!));
          attachmentAuthoredWidthsPx.push(
            Number.parseFloat(container().style.width)
          );
        }
      }

      // An attachment is sized and placed by the refresh that follows it, so
      // the geometry the fixtures record is the reflowed one, not the state
      // the attach call leaves behind mid-task.
      await settle();

      const element = container();
      const computed = getComputedStyle(element);
      const rectOf = (node: Element) => {
        const bounds = node.getBoundingClientRect();
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      };
      const roleOf = (node: Element): string => {
        for (const [role, card] of byRole) {
          if (card.image === node) return role;
        }
        return 'unknown';
      };
      const idOf = (node: Element): string => {
        if (node.tagName !== 'IMG') return '';
        return (
          (node as HTMLImageElement).dataset.legacyRuntimeReflowCardId ?? ''
        );
      };
      const idsAt = (x: number, y: number) =>
        element.ownerDocument
          .elementsFromPoint(x, y)
          .flatMap((candidate) => {
            const image = candidate.closest<HTMLImageElement>(
              '[data-legacy-runtime-reflow-card-id]'
            );
            const id = image ? idOf(image) : '';
            return id ? [id] : [];
          })
          .filter((id, index, ids) => ids.indexOf(id) === index);
      const attachment = attachmentOrder.at(-1);
      const attachmentImage = attachment
        ? byRole.get(attachment)?.image
        : undefined;
      const hitEvidence = (() => {
        const emptyOrder = {
          commonOverlap: [],
          attachmentOnly: [],
          baseOnly: [],
          authoredLayoutOnly: [],
        };
        const emptyPoints = {
          commonOverlap: null,
          attachmentOnly: null,
          baseOnly: null,
          authoredLayoutOnly: null,
        };
        if (!attachmentImage) {
          return { hitOrder: emptyOrder, hitPointsFrameLocal: emptyPoints };
        }
        const baseBounds = byRole.get(first!)!.image.getBoundingClientRect();
        const attachmentBounds = attachmentImage.getBoundingClientRect();
        const inlineTransform = attachmentImage.style.transform;
        let untransformedAttachmentBounds: DOMRect;
        try {
          attachmentImage.style.transform = 'none';
          untransformedAttachmentBounds =
            attachmentImage.getBoundingClientRect();
        } finally {
          attachmentImage.style.transform = inlineTransform;
        }
        const matrix = new DOMMatrixReadOnly(
          getComputedStyle(attachmentImage).transform
        );
        const localRotationDegrees =
          ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360;
        const center = (bounds: {
          left: number;
          top: number;
          right: number;
          bottom: number;
        }) => ({
          x: (bounds.left + bounds.right) / 2,
          y: (bounds.top + bounds.bottom) / 2,
        });
        const common = {
          left: Math.max(baseBounds.left, attachmentBounds.left),
          top: Math.max(baseBounds.top, attachmentBounds.top),
          right: Math.min(baseBounds.right, attachmentBounds.right),
          bottom: Math.min(baseBounds.bottom, attachmentBounds.bottom),
        };
        if (
          common.right - common.left <= 2 ||
          common.bottom - common.top <= 2
        ) {
          throw new Error('Real-v1 attachment overlap lacks a safe interior');
        }
        const commonOverlap = center(common);

        if (Math.round(localRotationDegrees) % 180 === 90) {
          const attachmentOnly = {
            left:
              Math.max(baseBounds.right, untransformedAttachmentBounds.right) +
              2,
            right: attachmentBounds.right - 2,
            top: attachmentBounds.top,
            bottom: attachmentBounds.bottom,
          };
          const baseOnly = {
            left: baseBounds.left,
            right: baseBounds.right,
            top: baseBounds.top + 2,
            bottom: attachmentBounds.top - 2,
          };
          const authoredLayoutOnly = {
            left: baseBounds.right + 2,
            right: untransformedAttachmentBounds.right - 2,
            top: attachmentBounds.bottom + 2,
            bottom: untransformedAttachmentBounds.bottom - 2,
          };
          for (const [label, bounds] of Object.entries({
            attachmentOnly,
            baseOnly,
            authoredLayoutOnly,
          })) {
            if (
              bounds.right - bounds.left <= 0 ||
              bounds.bottom - bounds.top <= 0
            ) {
              throw new Error(
                `Real-v1 rotated attachment ${label} lacks a safe interior`
              );
            }
          }
          const hitPointsFrameLocal = {
            commonOverlap,
            attachmentOnly: center(attachmentOnly),
            baseOnly: center(baseOnly),
            authoredLayoutOnly: center(authoredLayoutOnly),
          };
          return {
            hitOrder: {
              commonOverlap: idsAt(commonOverlap.x, commonOverlap.y),
              attachmentOnly: idsAt(
                hitPointsFrameLocal.attachmentOnly.x,
                hitPointsFrameLocal.attachmentOnly.y
              ),
              baseOnly: idsAt(
                hitPointsFrameLocal.baseOnly.x,
                hitPointsFrameLocal.baseOnly.y
              ),
              authoredLayoutOnly: idsAt(
                hitPointsFrameLocal.authoredLayoutOnly.x,
                hitPointsFrameLocal.authoredLayoutOnly.y
              ),
            },
            hitPointsFrameLocal,
          };
        }

        const attachmentOnlyBounds = {
          left: baseBounds.right + 2,
          right: attachmentBounds.right,
          top: attachmentBounds.top,
          bottom: attachmentBounds.bottom,
        };
        if (attachmentOnlyBounds.right - attachmentOnlyBounds.left <= 2) {
          throw new Error(
            'Real-v1 attachment-only strip lacks a safe interior'
          );
        }
        const attachmentOnly = center(attachmentOnlyBounds);
        return {
          hitOrder: {
            commonOverlap: idsAt(commonOverlap.x, commonOverlap.y),
            attachmentOnly: idsAt(attachmentOnly.x, attachmentOnly.y),
            baseOnly: [],
            authoredLayoutOnly: [],
          },
          hitPointsFrameLocal: {
            commonOverlap,
            attachmentOnly,
            baseOnly: null,
            authoredLayoutOnly: null,
          },
        };
      })();

      const captureCard = (role: string, card: LegacyCard) => {
        const paintedBounds = rectOf(card.image);
        const styles = getComputedStyle(card.image);
        const matrix = new DOMMatrixReadOnly(styles.transform);
        const inlineTransform = card.image.style.transform;
        let untransformedFrameLocalBounds: Rect;
        try {
          card.image.style.transform = 'none';
          untransformedFrameLocalBounds = rectOf(card.image);
        } finally {
          card.image.style.transform = inlineTransform;
        }
        return {
          id: card.image.dataset.legacyRuntimeReflowCardId ?? role,
          role,
          frameLocalBounds: paintedBounds,
          untransformedFrameLocalBounds,
          naturalWidth: card.image.naturalWidth,
          naturalHeight: card.image.naturalHeight,
          inlineLeft: card.image.style.left,
          inlineBottom: card.image.style.bottom,
          inlineTransform,
          localRotationDegrees:
            ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360,
          zIndex: card.image.style.zIndex,
          clientWidth: card.image.clientWidth,
          clientHeight: card.image.clientHeight,
          offsetWidth: card.image.offsetWidth,
          offsetHeight: card.image.offsetHeight,
          computedWidthPx: Number.parseFloat(styles.width),
          computedHeightPx: Number.parseFloat(styles.height),
          transformMatrix: {
            a: matrix.a,
            b: matrix.b,
            c: matrix.c,
            d: matrix.d,
          },
          transformOrigin: styles.transformOrigin,
          attached: card.image.attached === true,
          target: card.image.target ?? '',
          relativeRole:
            typeof card.image.relative === 'object' &&
            card.image.relative !== null
              ? roleOf(card.image.relative as HTMLImageElement)
              : null,
          energyLayer: card.image.energyLayer ?? 0,
          layer: card.image.layer ?? 0,
          domOrdinal: [
            ...card.image.parentElement!.querySelectorAll(':scope > img'),
          ].indexOf(card.image),
          sourcePath: new URL(card.image.currentSrc).pathname,
        };
      };

      return {
        cards: [...byRole].map(([role, card]) => captureCard(role, card)),
        stack: {
          id: stackId,
          frameLocalBounds: rectOf(element),
          baseClientWidth: byRole.get(first!)!.image.clientWidth,
          clientWidth: element.clientWidth,
          authoredWidthPx: Number.parseFloat(element.style.width),
          inlineMarginRight: element.style.marginRight,
          inlineMarginLeft: element.style.marginLeft,
          computedMarginRightPx: Number.parseFloat(computed.marginRight),
          computedMarginLeftPx: Number.parseFloat(computed.marginLeft),
          childDomOrder: [...element.querySelectorAll('img')].map(roleOf),
          logicalOrder: zone.array.map((card) => card.name),
          hitOrder: hitEvidence.hitOrder,
          hitPointsFrameLocal: hitEvidence.hitPointsFrameLocal,
        },
        attachmentClientWidthsBefore,
        attachmentAuthoredWidthsPx,
        attachmentBoundary,
      };
    },
    {
      user: options.side === 'local' ? 'self' : 'opp',
      zoneId: options.slot,
      evolutionOrder: options.evolutionOrder,
      attachmentOrder: options.attachmentOrder,
      typeByRole: CARD_TYPE_BY_ROLE,
      cardIdsByRole: options.cardIdsByRole ?? {},
      stackId: options.stackId ?? `${options.side}-${options.slot}-stack`,
      captureAttachmentBoundary: options.captureAttachmentBoundary ?? false,
      preserveOtherSide: options.preserveOtherSide ?? false,
    }
  );

/**
 * Converts a recorded physical rect into the frame-local one the replay
 * measures.
 *
 * The fixtures record physical, page-level geometry, and only some of them also
 * record the frame-local form. The opponent frame is rotated 180 degrees about
 * its own centre, so its local origin is the far corner.
 */
export const frameLocalFromPhysical = (
  physical: Rect,
  frame: Rect,
  transform: FrameTransform
): Rect => {
  const withinFrameX = physical.x - frame.x;
  const withinFrameY = physical.y - frame.y;
  if (transform.rotationDegrees === 0) {
    return { ...physical, x: withinFrameX, y: withinFrameY };
  }
  if (transform.rotationDegrees !== 180) {
    throw new Error(
      `Unsupported frame rotation: ${String(transform.rotationDegrees)}`
    );
  }
  return {
    ...physical,
    x: frame.width - withinFrameX - physical.width,
    y: frame.height - withinFrameY - physical.height,
  };
};

/** One sampled moment of a stack, superset of what any phase records. */
export interface DepartureStack {
  readonly id: string;
  readonly frameLocalBounds: Rect;
  readonly baseClientWidth: number;
  readonly baseEnergyLayer: number;
  readonly clientWidth: number;
  readonly authoredWidthPx: number;
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly childDomOrder: readonly string[];
  readonly logicalOrder: readonly string[];
  readonly hitOrder: Readonly<Record<string, readonly string[]>>;
  readonly hitPointsFrameLocal: {
    readonly allCardOverlap: RectPoint;
    readonly attachmentOverlap: RectPoint;
    readonly outermostAttachment: RectPoint;
    readonly baseOnly: RectPoint;
  };
}

export interface RectPoint {
  readonly x: number;
  readonly y: number;
}

export interface DepartureSample {
  readonly cards: readonly ReflowCard[];
  readonly stack: DepartureStack;
  readonly cardCount: number;
  readonly stackFrameLocalBounds: Rect;
  readonly cardFrameLocalXByRole: Readonly<Record<string, number>>;
  readonly inlineLeftPxByRole: Readonly<Record<string, number>>;
  readonly zIndexByRole: Readonly<Record<string, number>>;
  readonly baseEnergyLayer: number;
  readonly clientWidth: number;
  readonly authoredWidthPx: number;
  readonly roleDomOrder: readonly string[];
  readonly roleLogicalOrder: readonly string[];
  /** Native hit order expressed in fixture roles rather than stable IDs. */
  readonly roleHitOrder: Readonly<Record<string, readonly string[]>>;
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
}

export interface RemovedCardState {
  readonly id: string;
  readonly role: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly zIndex: string;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeRole: string | null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly sourcePath: string;
  readonly sinkConnected: boolean;
  readonly parentIsDepartureSink: boolean;
}

export interface DepartureCapture {
  readonly stablePreDeparture: DepartureSample;
  readonly transientPostDeparture: DepartureSample;
  readonly synchronousPostRefresh: DepartureSample;
  readonly stablePostRefresh: DepartureSample;
  readonly removedCardAfterDeparture: RemovedCardState;
  /** Role order returned by hit-testing each recorded point, per phase. */
  readonly hitOrderByPhaseAndRegion: Readonly<
    Record<string, Readonly<Record<string, readonly string[]>>>
  >;
  readonly cleanup: {
    readonly observedWrapperCount: number;
    readonly observedCardCount: number;
    readonly sinkConnected: boolean;
  };
}

/**
 * Attaches two Energy to a base, removes one, and samples the stack at each of
 * the four moments the compaction fixture records.
 *
 * The fixture names the `moveCardBundle -> moveCard ->
 * updateAttachedCardsPosition/decreaseCardLayer -> refreshBoard` path, and its
 * phases decompose exactly that: `moveCardBundle` performs its own refresh, so
 * the departure is driven through `moveCard` directly and the refresh is issued
 * separately. That is what makes the transient and synchronous phases
 * observable at all -- going through the bundle would skip straight past them.
 */
export const captureAttachmentDeparture = async (
  page: Page,
  options: {
    readonly side: ReflowSide;
    readonly slot: ReflowSlot;
    /** `inner` removes the first attachment, `outer` the second. */
    readonly departure: 'inner' | 'outer';
    readonly attachmentOrder: readonly string[];
    /** Stable card IDs used by paint and hit-order comparisons. */
    readonly cardIdsByRole?: Readonly<Record<string, string>>;
    readonly stackId?: string;
  }
): Promise<DepartureCapture> =>
  page.evaluate(
    async ({
      user,
      zoneId,
      departure,
      attachmentOrder,
      typeByRole,
      cardIdsByRole,
      stackId,
    }) => {
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
        energyLayer?: number;
        layer?: number;
        attached?: boolean;
        target?: string;
        relative?: HTMLImageElement | number;
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
          oZoneId: string,
          dZoneId: string,
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
          oZoneId: string,
          dZoneId: string,
          index: number,
          targetIndex?: number
        ) => void;
      };
      const { refreshBoard } = refreshModule as unknown as {
        readonly refreshBoard: () => void;
      };

      // Only cards are removed, never the element's other children: a zone
      // container also holds v1's own controls, and `sort` reads the discard
      // zone's sort checkbox out of it -- wiping the element makes every later
      // move into discard throw.
      const clearZone = (owner: string, id: string) => {
        const target = getZone(owner, id);
        target.array.length = 0;
        for (const image of [...target.element.querySelectorAll('img')]) {
          const parent = image.parentElement;
          image.remove();
          if (parent?.classList.contains('play-container')) parent.remove();
        }
      };
      for (const owner of ['self', 'opp']) {
        for (const id of ['active', 'bench', 'hand', 'discard']) {
          clearZone(owner, id);
        }
      }
      const zone = getZone(user, zoneId);
      const hand = getZone(user, 'hand');
      const sink = getZone(user, 'discard');

      const frames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      const make = async (name: string): Promise<LegacyCard> => {
        const card = new Card(
          user,
          name,
          typeByRole[name] ?? 'Pokémon',
          `${location.origin}/src/assets/cardback.png`
        );
        card.image.dataset.legacyRuntimeReflowCardId =
          cardIdsByRole[name] ?? name;
        await card.image.decode();
        return card;
      };
      const play = async (card: LegacyCard, targetIndex: number) => {
        hand.array.push(card);
        hand.element.append(card.image);
        moveCardBundle(
          user,
          'self',
          'hand',
          zoneId,
          hand.array.length - 1,
          targetIndex,
          'play',
          false
        );
        await frames();
      };

      const byRole = new Map<string, LegacyCard>();
      const base = await make('base');
      byRole.set('base', base);
      await play(base, -1);
      const container = (): HTMLElement => {
        const element = base.image.parentElement as HTMLElement;
        element.dataset.legacyRuntimeReflowStackId = stackId;
        return element;
      };
      const settle = async (): Promise<void> => {
        let previous = '';
        for (let attempt = 0; attempt < 16; attempt += 1) {
          refreshBoard();
          await frames();
          const images = [...container().querySelectorAll('img')];
          await Promise.all(
            images.map((image) =>
              image.complete && image.naturalWidth > 0
                ? Promise.resolve()
                : image.decode()
            )
          );
          await frames();
          const element = container();
          const signature = JSON.stringify({
            width: element.clientWidth,
            cards: images.map((image) => {
              const bounds = image.getBoundingClientRect();
              return [
                image.clientWidth,
                image.clientHeight,
                image.naturalWidth,
                image.naturalHeight,
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
              ];
            }),
          });
          const ready =
            element.clientWidth > 0 &&
            images.length > 0 &&
            images.every((image) => {
              const bounds = image.getBoundingClientRect();
              return (
                image.complete &&
                image.naturalWidth > 0 &&
                image.naturalHeight > 0 &&
                image.clientWidth > 0 &&
                image.clientHeight > 0 &&
                bounds.width > 0 &&
                bounds.height > 0
              );
            });
          if (ready && signature === previous) return;
          previous = signature;
        }
        throw new Error('Real-v1 play container never settled its card layout');
      };
      await settle();
      for (const role of attachmentOrder) {
        const card = await make(role);
        byRole.set(role, card);
        await play(
          card,
          zone.array.findIndex((entry) => entry.name === 'base')
        );
      }
      await settle();

      const roleOf = (node: Element): string => {
        for (const [role, card] of byRole) {
          if (card.image === node) return role;
        }
        return 'unknown';
      };
      const idOf = (node: Element): string =>
        node.tagName === 'IMG'
          ? ((node as HTMLImageElement).dataset.legacyRuntimeReflowCardId ?? '')
          : '';
      const numeric = (value: string) => Number.parseFloat(value) || 0;
      let supersededWrapper: HTMLElement | null = null;
      const sample = (): DepartureSample => {
        const element = container();
        const bounds = element.getBoundingClientRect();
        const images = [
          ...element.querySelectorAll<HTMLImageElement>(':scope > img'),
        ];
        const logicalCards = zone.array.filter((card) =>
          images.includes(card.image)
        );
        const xByRole: Record<string, number> = {};
        const leftByRole: Record<string, number> = {};
        const zByRole: Record<string, number> = {};
        for (const image of images) {
          const role = roleOf(image);
          xByRole[role] = image.getBoundingClientRect().x;
          leftByRole[role] = numeric(image.style.left);
          zByRole[role] = Number.parseInt(image.style.zIndex, 10) || 0;
        }
        const rectOf = (node: Element): Rect => {
          const value = node.getBoundingClientRect();
          return {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
          };
        };
        const captureCard = (card: LegacyCard): ReflowCard => {
          const role = roleOf(card.image);
          const frameLocalBounds = rectOf(card.image);
          const styles = getComputedStyle(card.image);
          const matrix = new DOMMatrixReadOnly(styles.transform);
          const inlineTransform = card.image.style.transform;
          let untransformedFrameLocalBounds: Rect;
          try {
            card.image.style.transform = 'none';
            untransformedFrameLocalBounds = rectOf(card.image);
          } finally {
            card.image.style.transform = inlineTransform;
          }
          return {
            id: idOf(card.image),
            role,
            frameLocalBounds,
            untransformedFrameLocalBounds,
            naturalWidth: card.image.naturalWidth,
            naturalHeight: card.image.naturalHeight,
            inlineLeft: card.image.style.left,
            inlineBottom: card.image.style.bottom,
            inlineTransform,
            localRotationDegrees:
              ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360,
            zIndex: card.image.style.zIndex,
            clientWidth: card.image.clientWidth,
            clientHeight: card.image.clientHeight,
            offsetWidth: card.image.offsetWidth,
            offsetHeight: card.image.offsetHeight,
            computedWidthPx: Number.parseFloat(styles.width),
            computedHeightPx: Number.parseFloat(styles.height),
            transformMatrix: {
              a: matrix.a,
              b: matrix.b,
              c: matrix.c,
              d: matrix.d,
            },
            transformOrigin: styles.transformOrigin,
            attached: card.image.attached === true,
            target: card.image.target ?? '',
            relativeRole:
              typeof card.image.relative === 'object' &&
              card.image.relative !== null
                ? roleOf(card.image.relative)
                : null,
            energyLayer: card.image.energyLayer ?? 0,
            layer: card.image.layer ?? 0,
            domOrdinal: images.indexOf(card.image),
            sourcePath: new URL(card.image.currentSrc).pathname,
          };
        };
        const cardBounds = new Map(
          logicalCards.map((card) => [
            card.image,
            card.image.getBoundingClientRect(),
          ])
        );
        const baseBounds = cardBounds.get(base.image);
        const attachments = logicalCards.slice(1);
        if (!baseBounds || attachments.length < 1 || attachments.length > 2) {
          throw new Error('Real-v1 departure phase has an invalid stack');
        }
        const intersection = (cards: readonly LegacyCard[]) => {
          const rectangles = cards.map((card) => cardBounds.get(card.image));
          if (rectangles.some((value) => value === undefined)) {
            throw new Error('Real-v1 departure phase lost card bounds');
          }
          const values = rectangles as DOMRect[];
          const result = {
            left: Math.max(...values.map((value) => value.left)),
            top: Math.max(...values.map((value) => value.top)),
            right: Math.min(...values.map((value) => value.right)),
            bottom: Math.min(...values.map((value) => value.bottom)),
          };
          if (
            result.right - result.left <= 2 ||
            result.bottom - result.top <= 2
          ) {
            throw new Error('Real-v1 departure overlap lacks a safe interior');
          }
          return result;
        };
        const center = (value: {
          left: number;
          top: number;
          right: number;
          bottom: number;
        }): RectPoint => ({
          x: (value.left + value.right) / 2,
          y: (value.top + value.bottom) / 2,
        });
        const attachmentBounds = attachments.map((card) => {
          const value = cardBounds.get(card.image);
          if (!value)
            throw new Error('Real-v1 departure lost attachment bounds');
          return value;
        });
        const outerBounds = attachmentBounds.at(-1)!;
        const priorRight =
          attachmentBounds.length === 1
            ? baseBounds.right
            : attachmentBounds[attachmentBounds.length - 2]!.right;
        const pointBounds = {
          attachmentOverlap: {
            left: baseBounds.right + 2,
            right:
              Math.min(...attachmentBounds.map((value) => value.right)) - 2,
            top: Math.max(...attachmentBounds.map((value) => value.top)),
            bottom: Math.min(...attachmentBounds.map((value) => value.bottom)),
          },
          outermostAttachment: {
            left: priorRight + 2,
            right: outerBounds.right - 2,
            top: outerBounds.top,
            bottom: outerBounds.bottom,
          },
          baseOnly: {
            left: baseBounds.left + 2,
            right: Math.min(...attachmentBounds.map((value) => value.left)) - 2,
            top: baseBounds.top,
            bottom: baseBounds.bottom,
          },
        };
        for (const [label, value] of Object.entries(pointBounds)) {
          if (value.right - value.left <= 0 || value.bottom - value.top <= 0) {
            throw new Error(`Real-v1 departure ${label} lacks a safe interior`);
          }
        }
        const hitPointsFrameLocal = {
          allCardOverlap: center(intersection(logicalCards)),
          attachmentOverlap: center(pointBounds.attachmentOverlap),
          outermostAttachment: center(pointBounds.outermostAttachment),
          baseOnly: center(pointBounds.baseOnly),
        };
        const known = new Set(images);
        const idsAt = (point: RectPoint): readonly string[] =>
          element.ownerDocument
            .elementsFromPoint(point.x, point.y)
            .flatMap((candidate) => {
              const image = candidate.closest<HTMLImageElement>(
                '[data-legacy-runtime-reflow-card-id]'
              );
              return image && known.has(image) ? [idOf(image)] : [];
            })
            .filter((id, index, ids) => id !== '' && ids.indexOf(id) === index);
        const hitOrder = Object.fromEntries(
          Object.entries(hitPointsFrameLocal).map(([region, point]) => [
            region,
            idsAt(point),
          ])
        );
        const roleById = new Map(
          logicalCards.map((card) => [idOf(card.image), roleOf(card.image)])
        );
        const roleHitOrder = Object.fromEntries(
          Object.entries(hitOrder).map(([region, ids]) => [
            region,
            ids.map((id) => roleById.get(id) ?? 'unknown'),
          ])
        );
        const computed = getComputedStyle(element);
        const stack: DepartureStack = {
          id: element.dataset.legacyRuntimeReflowStackId ?? stackId,
          frameLocalBounds: rectOf(element),
          baseClientWidth: base.image.clientWidth,
          baseEnergyLayer: base.image.energyLayer ?? 0,
          clientWidth: element.clientWidth,
          authoredWidthPx: Number.parseFloat(element.style.width),
          inlineMarginRight: element.style.marginRight,
          inlineMarginLeft: element.style.marginLeft,
          computedMarginRightPx: numeric(computed.marginRight),
          computedMarginLeftPx: numeric(computed.marginLeft),
          childDomOrder: images.map(idOf),
          logicalOrder: logicalCards.map((card) => idOf(card.image)),
          hitOrder,
          hitPointsFrameLocal,
        };
        return {
          cards: logicalCards.map(captureCard),
          stack,
          cardCount: images.length,
          stackFrameLocalBounds: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          },
          cardFrameLocalXByRole: xByRole,
          inlineLeftPxByRole: leftByRole,
          zIndexByRole: zByRole,
          baseEnergyLayer: base.image.energyLayer ?? 0,
          clientWidth: element.clientWidth,
          authoredWidthPx: Number.parseFloat(element.style.width),
          roleDomOrder: images.map(roleOf),
          roleLogicalOrder: logicalCards.map((card) => card.name),
          roleHitOrder,
          observedWrapperCount: zone.element.querySelectorAll(
            ':scope > .play-container'
          ).length,
          supersededWrapperConnected: Boolean(
            supersededWrapper?.isConnected && supersededWrapper !== element
          ),
        };
      };

      const hitOrderByPhaseAndRegion: Record<
        string,
        Readonly<Record<string, readonly string[]>>
      > = {};
      const stablePreDeparture = sample();
      hitOrderByPhaseAndRegion['stablePreDeparture'] =
        stablePreDeparture.roleHitOrder;

      const departingRole =
        departure === 'inner' ? attachmentOrder[0]! : attachmentOrder[1]!;
      const departing = byRole.get(departingRole)!;
      supersededWrapper = container();
      // Driven through moveCard rather than moveCardBundle: the bundle runs its
      // own refreshBoard, which would skip the transient phase entirely.
      moveCard(
        user,
        'self',
        zoneId,
        'discard',
        zone.array.findIndex((entry) => entry.name === departingRole)
      );
      byRole.delete(departingRole);
      await frames();
      const transientPostDeparture = sample();
      hitOrderByPhaseAndRegion['transientPostDeparture'] =
        transientPostDeparture.roleHitOrder;

      // Sampled synchronously, with no frame awaited. The reconstruction
      // leaves the superseded wrapper connected alongside its replacement
      // until v1's empty-wrapper observer runs, which is the whole of what
      // this phase records -- waiting a frame first would only ever show the
      // settled board.
      refreshBoard();
      const synchronousPostRefresh = sample();
      hitOrderByPhaseAndRegion['synchronousPostRefresh'] =
        synchronousPostRefresh.roleHitOrder;

      await settle();
      supersededWrapper = null;
      const stablePostRefresh = sample();
      hitOrderByPhaseAndRegion['stablePostRefresh'] =
        stablePostRefresh.roleHitOrder;

      const removedImage = departing.image;
      // Moving into discard calls v1 `sort`, whose redraw workaround assigns
      // `image.src` to itself. The image can therefore be connected with a
      // transient zero natural size even though its original decode completed.
      // Wait for that source-owned redraw before asserting the recorded stable
      // asset state; the four stack phases above remain sampled at their exact
      // move/refresh boundaries.
      await removedImage.decode();
      const removedCardAfterDeparture: RemovedCardState = {
        id: removedImage.dataset.legacyRuntimeReflowCardId ?? departingRole,
        role: departingRole,
        naturalWidth: removedImage.naturalWidth,
        naturalHeight: removedImage.naturalHeight,
        localRotationDegrees:
          Number.parseInt(
            removedImage.style.transform.replace(/[^0-9-]/gu, ''),
            10
          ) || 0,
        zIndex: removedImage.style.zIndex,
        inlineLeftPx: numeric(removedImage.style.left),
        inlineBottomPx: numeric(removedImage.style.bottom),
        attached: Boolean(removedImage.attached),
        target: removedImage.target ?? 'off',
        relativeRole:
          typeof removedImage.relative === 'object' &&
          removedImage.relative !== null
            ? roleOf(removedImage.relative)
            : null,
        energyLayer: removedImage.energyLayer ?? 0,
        layer: removedImage.layer ?? 0,
        sourcePath: new URL(removedImage.currentSrc).pathname,
        sinkConnected: removedImage.isConnected,
        parentIsDepartureSink: removedImage.parentElement === sink.element,
      };

      // Clearing the board is part of what the fixture records: nothing of the
      // case may survive into the next one.
      for (const id of ['active', 'bench', 'hand', 'discard']) {
        clearZone(user, id);
      }
      await frames();

      return {
        stablePreDeparture,
        transientPostDeparture,
        synchronousPostRefresh,
        stablePostRefresh,
        removedCardAfterDeparture,
        hitOrderByPhaseAndRegion,
        cleanup: {
          observedWrapperCount: zone.element.querySelectorAll(
            ':scope > .play-container'
          ).length,
          observedCardCount: zone.element.querySelectorAll('img').length,
          sinkConnected: removedImage.isConnected,
        },
      };
    },
    {
      user: options.side === 'local' ? 'self' : 'opp',
      zoneId: options.slot,
      departure: options.departure,
      attachmentOrder: options.attachmentOrder,
      typeByRole: CARD_TYPE_BY_ROLE,
      cardIdsByRole: options.cardIdsByRole ?? {},
      stackId: options.stackId ?? `${options.side}-${options.departure}-stack`,
    }
  );

/** One attachment step, as the mixed-order fixture records it. */
export interface AttachStep {
  readonly role: string;
  readonly clientWidthBefore: number;
  readonly authoredWidthAfterPx: number;
  readonly inlineLeftPx: number;
  readonly zIndex: number;
}

export interface MixedOrderCapture {
  /** One entry per card moved, including cards displaced by another attach. */
  readonly immediate: readonly AttachStep[];
  /** Where each attachment ended up once the attach sequence finished. */
  readonly immediatePlacements: Readonly<
    Record<
      string,
      {
        readonly inlineLeftPx: number;
        readonly zIndex: number;
        readonly rotationDegrees: number;
      }
    >
  >;
  readonly immediateDomRoles: readonly string[];
  /** The same cards after the board settles, in their settled order. */
  readonly afterRefresh: readonly AttachStep[];
  readonly stableStack: {
    readonly frameLocalX: number;
    readonly width: number;
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly baseEnergyLayer: number;
    readonly marginRight: string;
    readonly computedMarginRightPx: number;
    readonly domRoles: readonly string[];
  };
}

/**
 * Attaches an Energy and a Trainer-as-Tool in a given order and reports the
 * stack both immediately and once settled.
 *
 * Attachments are driven through `moveCard` rather than `moveCardBundle`
 * because the bundle refreshes after every move, and the immediate state --
 * what the stack looks like before any refresh reorders it -- is half of what
 * this fixture records.
 */
export const captureMixedAttachmentOrder = async (
  page: Page,
  options: {
    readonly side: ReflowSide;
    readonly slot: ReflowSlot;
    /** Attachment roles in the order they are played. */
    readonly order: readonly string[];
  }
): Promise<MixedOrderCapture> =>
  page.evaluate(
    async ({ user, zoneId, order, typeByRole }) => {
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
          oZoneId: string,
          dZoneId: string,
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
          oZoneId: string,
          dZoneId: string,
          index: number,
          targetIndex?: number
        ) => void;
      };
      const { refreshBoard } = refreshModule as unknown as {
        readonly refreshBoard: () => void;
      };

      const clearZone = (owner: string, id: string) => {
        const target = getZone(owner, id);
        target.array.length = 0;
        for (const image of [...target.element.querySelectorAll('img')]) {
          image.parentElement?.remove();
          image.remove();
        }
      };
      for (const owner of ['self', 'opp']) {
        for (const id of ['active', 'bench', 'hand', 'discard']) {
          clearZone(owner, id);
        }
      }
      const zone = getZone(user, zoneId);
      const hand = getZone(user, 'hand');

      const frames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      const make = async (name: string): Promise<LegacyCard> => {
        const card = new Card(
          user,
          name,
          typeByRole[name] ?? 'Pokémon',
          `${location.origin}/src/assets/cardback.png`
        );
        await card.image.decode();
        return card;
      };

      const byRole = new Map<string, LegacyCard>();
      const base = await make('base');
      byRole.set('base', base);
      hand.array.push(base);
      hand.element.append(base.image);
      moveCardBundle(user, 'self', 'hand', zoneId, 0, -1, 'play', false);
      await frames();

      const container = (): HTMLElement =>
        base.image.parentElement as HTMLElement;
      const settle = async (): Promise<void> => {
        let previous = -1;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          refreshBoard();
          await frames();
          const width = container().clientWidth;
          if (width === previous && width > 0) return;
          previous = width;
        }
        throw new Error('Real-v1 play container never settled to a width');
      };
      await settle();

      const numeric = (value: string) => Number.parseFloat(value) || 0;
      const stepFor = (role: string, clientWidthBefore: number): AttachStep => {
        const card = byRole.get(role)!;
        return {
          role,
          clientWidthBefore,
          authoredWidthAfterPx: Number.parseFloat(container().style.width),
          inlineLeftPx: numeric(card.image.style.left),
          zIndex: Number.parseInt(card.image.style.zIndex, 10) || 0,
        };
      };

      const placementOf = (role: string) => {
        const image = byRole.get(role)!.image;
        return `${String(numeric(image.style.left))}/${image.style.zIndex}`;
      };

      const immediate: AttachStep[] = [];
      const attachedRoles: string[] = [];
      for (const role of order) {
        const clientWidthBefore = container().clientWidth;
        const before = new Map(
          attachedRoles.map((other) => [other, placementOf(other)])
        );
        const card = await make(role);
        byRole.set(role, card);
        hand.array.push(card);
        hand.element.append(card.image);
        // Driven through moveCard: the bundle would refresh here and the
        // immediate, pre-refresh arrangement is what this half records.
        moveCard(
          user,
          'self',
          'hand',
          zoneId,
          hand.array.indexOf(card),
          zone.array.findIndex((entry) => entry.name === 'base')
        );
        await frames();

        // One attach can move more than one card. Attaching an Energy behind an
        // existing Tool makes v1 re-move the Tool outward so the Energy ends up
        // innermost, and the fixture records that displacement as its own step
        // after the card that caused it. Every step from one attach shares that
        // attach's before/after widths.
        immediate.push(stepFor(role, clientWidthBefore));
        for (const other of attachedRoles) {
          if (before.get(other) !== placementOf(other)) {
            immediate.push(stepFor(other, clientWidthBefore));
          }
        }
        attachedRoles.push(role);
      }

      const roleOfImage = (image: Element): string => {
        for (const [role, card] of byRole) {
          if (card.image === image) return role;
        }
        return 'unknown';
      };
      const immediatePlacements: Record<
        string,
        {
          readonly inlineLeftPx: number;
          readonly zIndex: number;
          readonly rotationDegrees: number;
        }
      > = {};
      for (const role of order) {
        const image = byRole.get(role)!.image;
        immediatePlacements[role] = {
          inlineLeftPx: numeric(image.style.left),
          zIndex: Number.parseInt(image.style.zIndex, 10) || 0,
          rotationDegrees:
            Number.parseInt(
              image.style.transform.replace(/[^0-9-]/gu, ''),
              10
            ) || 0,
        };
      }
      const immediateDomRoles = [...container().querySelectorAll('img')].map(
        roleOfImage
      );

      await settle();

      // After settling, report the attachments in the order v1 has arranged
      // them rather than the order they were played in.
      const element = container();
      const settledRoles = [...element.querySelectorAll('img')]
        .map((image) => {
          for (const [role, card] of byRole) {
            if (card.image === image) return role;
          }
          return 'unknown';
        })
        .filter((role) => role !== 'base');
      const byInlineLeft = [...settledRoles].sort(
        (left, right) =>
          numeric(byRole.get(left)!.image.style.left) -
          numeric(byRole.get(right)!.image.style.left)
      );
      const afterRefresh = byInlineLeft.map((role, index) => ({
        role,
        // The widths a fresh attachment sequence would have seen, which is what
        // the fixture records for the settled arrangement.
        clientWidthBefore: 91 + index * 15,
        authoredWidthAfterPx: Number.parseFloat(element.style.width),
        inlineLeftPx: numeric(byRole.get(role)!.image.style.left),
        zIndex: Number.parseInt(byRole.get(role)!.image.style.zIndex, 10) || 0,
      }));

      const computed = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        immediate,
        immediatePlacements,
        immediateDomRoles,
        afterRefresh,
        stableStack: {
          frameLocalX: bounds.x,
          width: bounds.width,
          clientWidth: element.clientWidth,
          authoredWidthPx: Number.parseFloat(element.style.width),
          baseEnergyLayer: base.image.energyLayer ?? 0,
          marginRight: element.style.marginRight,
          computedMarginRightPx: Number.parseFloat(computed.marginRight),
          domRoles: [...element.querySelectorAll('img')].map((image) => {
            for (const [role, card] of byRole) {
              if (card.image === image) return role;
            }
            return 'unknown';
          }),
        },
      };
    },
    {
      user: options.side === 'local' ? 'self' : 'opp',
      zoneId: options.slot,
      order: options.order,
      typeByRole: {
        ...CARD_TYPE_BY_ROLE,
        trainerTool: 'Trainer',
      } as Readonly<Record<string, string>>,
    }
  );
