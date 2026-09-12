import type { Page } from '@playwright/test';

export type MarkerSide = 'local' | 'opponent';
export type MarkerSlot = 'active' | 'bench';
export type MarkerKind = 'damage' | 'specialCondition' | 'ability';

export interface MarkerRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Inline style numbers a marker carries, `null` where the style is unset. */
export interface MarkerStyles {
  readonly inlineLeftPx: number | null;
  readonly inlineTopPx: number | null;
  readonly inlineRightPx: number | null;
  readonly inlineBottomPx: number | null;
  readonly inlineWidthPx: number | null;
  readonly inlineHeightPx: number | null;
  readonly inlineLineHeightPx: number | null;
  readonly inlineFontSizePx: number | null;
}

export interface CapturedMarker extends MarkerStyles {
  readonly id: string;
  readonly kind: MarkerKind;
  readonly present: boolean;
  readonly bounds: MarkerRect;
  readonly className: string;
  readonly parentZoneId: string;
  readonly domOrdinal: number;
  readonly textContent: string;
  readonly contentEditable: string;
  readonly pointerEvents: string;
  readonly display: string;
  readonly inlineDisplay: string;
  readonly zIndex: number;
  readonly backgroundColor: string;
  readonly color: string;
  readonly borderRadius: string;
  readonly localRotationDegrees: number;
  readonly hitOrder: readonly string[];
}

export interface RuntimeMarkerCard {
  readonly id: string;
  readonly frameLocalBounds: MarkerRect;
  readonly untransformedFrameLocalBounds: MarkerRect;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly inlineTransform: string;
  readonly zIndex: number;
  readonly pokemonBreak: boolean;
  readonly domOrdinal: number;
  readonly sourcePath: string;
}

export interface RuntimeMarkerWrapper {
  readonly id: string;
  readonly frameLocalBounds: MarkerRect;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly authoredWidthPx: number | null;
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly childImageCount: number;
}

export interface MarkerPhase {
  readonly name: string;
  readonly rotationDegrees: number;
  readonly card: MarkerRect;
  /** The card's box with its own rotation removed. */
  readonly untransformedCard: MarkerRect;
  readonly wrapper: MarkerRect;
  readonly wrapperMargins: readonly [string, string, number, number];
  readonly damage: CapturedMarker;
  readonly specialCondition: CapturedMarker;
  readonly ability: CapturedMarker;
  readonly cardDetails: RuntimeMarkerCard;
  readonly wrapperDetails: RuntimeMarkerWrapper;
  readonly markers: readonly CapturedMarker[];
  readonly cardOnlyHitOrder: readonly string[];
}

export interface MarkerCapture {
  readonly initialCard: {
    readonly frameLocalBounds: MarkerRect;
    readonly clientWidth: number;
    readonly clientHeight: number;
    readonly initialInlineMargins: {
      readonly right: string;
      readonly left: string;
    };
    /** `[inlineRight, inlineLeft, computedRightPx, computedLeftPx]`. */
    readonly initialWrapperMargins: readonly [string, string, number, number];
    readonly details: RuntimeMarkerCard;
  };
  readonly phases: readonly MarkerPhase[];
  /** `[input, textContent, backgroundColor, color]` per special condition. */
  readonly paletteTrace: readonly (readonly [string, string, string, string])[];
  readonly cleanup: {
    readonly markerCount: number;
    readonly cardPointersAreNull: boolean;
    readonly wrapperCount: number;
    readonly cardCount: number;
  };
}

/**
 * Replays a marker fixture's own `callTrace` against the real v1 counter hooks.
 *
 * The marker fixtures record a card being given a damage counter, a special
 * condition cycled through every code, and an ability counter, then rotated a
 * full turn and stripped again -- capturing where each marker sits at every
 * quarter. That is `addDamageCounter`, `updateSpecialCondition` and friends
 * driven directly, which is what this does.
 *
 * The card's untransformed box is measured by removing its rotation, reading
 * the box, and putting the rotation back. A rotated element's
 * `getBoundingClientRect` is the rotated box, so the unrotated one cannot be
 * read any other way, and the fixture records both.
 */
export const captureMarkerRotation = async (
  page: Page,
  options: {
    readonly side: MarkerSide;
    readonly slot: MarkerSlot;
    readonly damageInitial: string;
    readonly damageUpdated: string;
    readonly specialConditionInputs: readonly string[];
    /** Phase names, in capture order: pre-rotation, then one per quarter. */
    readonly phaseNames: readonly string[];
    readonly cardId?: string;
    readonly stackId?: string;
    readonly markerIdsByKind?: Readonly<Record<MarkerKind, string>>;
    /** Keep an already captured opposite-side marker stack for paint. */
    readonly preserveOtherSide?: boolean;
    /** Leave the marked card connected after its requested phases. */
    readonly retainMarkedPaint?: boolean;
  }
): Promise<MarkerCapture> =>
  page.evaluate(
    async ({
      user,
      zoneId,
      damageInitial,
      damageUpdated,
      specialConditionInputs,
      phaseNames,
      cardId,
      stackId,
      markerIdsByKind,
      preserveOtherSide,
      retainMarkedPaint,
    }) => {
      const load = (specifier: string): Promise<Record<string, never>> =>
        import(/* @vite-ignore */ specifier);
      const [
        cardModule,
        zoneModule,
        placementModule,
        damageModule,
        conditionModule,
        abilityModule,
        rotateModule,
      ] = await Promise.all([
        load('/src/setup/deck-constructor/card.js'),
        load('/src/setup/zones/get-zone.js'),
        load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
        load('/src/actions/counters/damage-counter.js'),
        load('/src/actions/counters/special-condition.js'),
        load('/src/actions/counters/ability-counter.js'),
        load('/src/actions/general/rotate-card.js'),
      ]);

      interface MarkerElement extends HTMLElement {
        handleRemove?: () => void;
      }
      interface LegacyImage extends HTMLImageElement {
        damageCounter?: MarkerElement | null;
        specialCondition?: MarkerElement | null;
        abilityCounter?: MarkerElement | null;
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
      const { getZone } = zoneModule as unknown as {
        readonly getZone: (user: string, zoneId: string) => LegacyZone;
      };
      const { initializeActiveBenchCard } = placementModule as unknown as {
        readonly initializeActiveBenchCard: (
          user: string,
          card: LegacyCard,
          zoneId: string,
          zone: LegacyZone
        ) => void;
      };
      const { addDamageCounter, updateDamageCounter, removeDamageCounter } =
        damageModule as unknown as {
          readonly addDamageCounter: (
            user: string,
            zoneId: string,
            index: number,
            amount: string,
            emit?: boolean
          ) => void;
          readonly updateDamageCounter: (
            user: string,
            zoneId: string,
            index: number,
            amount: string,
            emit?: boolean
          ) => void;
          readonly removeDamageCounter: (
            user: string,
            zoneId: string,
            index: number,
            emit?: boolean
          ) => void;
        };
      const {
        addSpecialCondition,
        updateSpecialCondition,
        removeSpecialCondition,
      } = conditionModule as unknown as {
        readonly addSpecialCondition: (
          user: string,
          zoneId: string,
          index: number,
          emit?: boolean
        ) => void;
        readonly updateSpecialCondition: (
          user: string,
          zoneId: string,
          index: number,
          text: string,
          emit?: boolean
        ) => void;
        readonly removeSpecialCondition: (
          user: string,
          zoneId: string,
          index: number,
          emit?: boolean
        ) => void;
      };
      const { addAbilityCounter, removeAbilityCounter } =
        abilityModule as unknown as {
          readonly addAbilityCounter: (
            user: string,
            zoneId: string,
            index: number
          ) => void;
          readonly removeAbilityCounter: (
            user: string,
            zoneId: string,
            index: number,
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

      // Cards and their wrappers go, including wrappers left empty: an empty
      // play container keeps whatever width was last authored on it, and the
      // next card placed into the slot inherits that rather than shrink-
      // wrapping. Everything else in the zone stays, since a zone element also
      // holds v1's own controls.
      const clearZone = (owner: string, id: string) => {
        const target = getZone(owner, id);
        target.array.length = 0;
        for (const image of [...target.element.querySelectorAll('img')]) {
          image.remove();
        }
        for (const wrapper of [
          ...target.element.querySelectorAll('.play-container'),
        ]) {
          wrapper.remove();
        }
      };
      for (const owner of preserveOtherSide ? [user] : ['self', 'opp']) {
        for (const id of ['active', 'bench', 'hand', 'discard']) {
          clearZone(owner, id);
        }
      }
      const zone = getZone(user, zoneId);

      const frames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      const card = new Card(
        user,
        'marked',
        'Pokémon',
        `${location.origin}/src/assets/cardback.png`
      );
      card.image.dataset.legacyRuntimeMarkerCardId = cardId;
      await card.image.decode();
      zone.array.push(card);
      initializeActiveBenchCard(user, card, zoneId, zone);
      // Wait for the card to actually have layout rather than for a fixed
      // number of frames. The wrapper authors no width and shrink-wraps its
      // card, so measuring before the image is laid out reports a zero-width
      // wrapper with the card overflowing it -- a different card box entirely,
      // and one that showed up as an order-dependent flake between the two
      // sides.
      for (
        let attempt = 0;
        attempt < 20 && card.image.clientWidth === 0;
        attempt += 1
      ) {
        await frames();
      }
      if (card.image.clientWidth === 0) {
        throw new Error('Real-v1 marker card never received layout');
      }

      const container = (): HTMLElement => {
        const element = card.image.parentElement as HTMLElement;
        element.dataset.legacyRuntimeMarkerStackId = stackId;
        return element;
      };
      // Deliberately never refreshed. `initializeActiveBenchCard` authors no
      // width on the wrapper, so it shrink-wraps to the card's own 90.5625px
      // rather than the 91px a refresh would author -- which is exactly what
      // this fixture records. Refreshing would move the card a fifth of a pixel
      // and measure a different card than the recording describes.

      const rectOf = (node: Element): MarkerRect => {
        const bounds = node.getBoundingClientRect();
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      };
      const inline = (node: HTMLElement, property: string): number | null => {
        const raw = node.style.getPropertyValue(property);
        if (!raw) return null;
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) ? value : null;
      };
      const idOf = (node: Element): string =>
        node.tagName === 'IMG'
          ? ((node as HTMLImageElement).dataset.legacyRuntimeMarkerCardId ?? '')
          : ((node as HTMLElement).dataset.legacyRuntimeMarkerId ?? '');
      const idsAt = (x: number, y: number): readonly string[] =>
        card.image.ownerDocument
          .elementsFromPoint(x, y)
          .flatMap((candidate) => {
            const target = candidate.closest<HTMLElement>(
              '[data-legacy-runtime-marker-id], [data-legacy-runtime-marker-card-id]'
            );
            const id = target ? idOf(target) : '';
            return id ? [id] : [];
          })
          .filter((id, index, ids) => ids.indexOf(id) === index);
      const markerOf = (
        node: MarkerElement | null | undefined,
        kind: MarkerKind
      ): CapturedMarker => {
        if (!node) {
          return {
            id: markerIdsByKind[kind],
            kind,
            present: false,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            className: '',
            parentZoneId: '',
            domOrdinal: -1,
            textContent: '',
            contentEditable: 'inherit',
            pointerEvents: 'auto',
            display: 'none',
            inlineDisplay: '',
            inlineLeftPx: null,
            inlineTopPx: null,
            inlineRightPx: null,
            inlineBottomPx: null,
            inlineWidthPx: null,
            inlineHeightPx: null,
            inlineLineHeightPx: null,
            inlineFontSizePx: null,
            zIndex: 0,
            backgroundColor: '',
            color: '',
            borderRadius: '',
            localRotationDegrees: 0,
            hitOrder: [],
          };
        }
        node.dataset.legacyRuntimeMarkerId = markerIdsByKind[kind];
        node.dataset.legacyRuntimeMarkerKind = kind;
        const bounds = node.getBoundingClientRect();
        const styles = getComputedStyle(node);
        const matrix = new DOMMatrixReadOnly(styles.transform);
        return {
          id: markerIdsByKind[kind],
          kind,
          present: true,
          bounds: rectOf(node),
          className: node.className,
          parentZoneId: node.parentElement?.id ?? '',
          domOrdinal: [...zone.element.children].indexOf(node),
          textContent: node.textContent ?? '',
          contentEditable: node.contentEditable,
          pointerEvents: styles.pointerEvents,
          display: styles.display,
          inlineDisplay: node.style.display,
          inlineLeftPx: inline(node, 'left'),
          inlineTopPx: inline(node, 'top'),
          inlineRightPx: inline(node, 'right'),
          inlineBottomPx: inline(node, 'bottom'),
          inlineWidthPx: inline(node, 'width'),
          inlineHeightPx: inline(node, 'height'),
          inlineLineHeightPx: inline(node, 'line-height'),
          inlineFontSizePx: inline(node, 'font-size'),
          zIndex: Number.parseInt(styles.zIndex, 10) || 0,
          backgroundColor: styles.backgroundColor,
          color: styles.color,
          borderRadius: styles.borderRadius,
          localRotationDegrees:
            ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360,
          hitOrder: idsAt(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2
          ),
        };
      };
      const rotationOf = (image: LegacyImage) =>
        Number.parseInt(image.style.transform.replace(/[^0-9-]/gu, ''), 10) ||
        0;
      const captureCard = (): RuntimeMarkerCard => {
        const frameLocalBounds = rectOf(card.image);
        const priorTransform = card.image.style.transform;
        card.image.style.transform = 'none';
        const untransformedFrameLocalBounds = rectOf(card.image);
        card.image.style.transform = priorTransform;
        const styles = getComputedStyle(card.image);
        const matrix = new DOMMatrixReadOnly(styles.transform);
        return {
          id: cardId,
          frameLocalBounds,
          untransformedFrameLocalBounds,
          clientWidth: card.image.clientWidth,
          clientHeight: card.image.clientHeight,
          naturalWidth: card.image.naturalWidth,
          naturalHeight: card.image.naturalHeight,
          localRotationDegrees:
            ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360,
          inlineTransform: card.image.style.transform,
          zIndex: Number.parseInt(styles.zIndex, 10) || 0,
          pokemonBreak: card.image.PokémonBreak === true,
          domOrdinal: [...container().querySelectorAll(':scope > img')].indexOf(
            card.image
          ),
          sourcePath: new URL(card.image.currentSrc).pathname,
        };
      };
      const sample = (name: string): MarkerPhase => {
        const element = container();
        const computed = getComputedStyle(element);
        for (const [kind, marker] of [
          ['damage', card.image.damageCounter],
          ['specialCondition', card.image.specialCondition],
          ['ability', card.image.abilityCounter],
        ] as const) {
          if (marker) {
            marker.dataset.legacyRuntimeMarkerId = markerIdsByKind[kind];
            marker.dataset.legacyRuntimeMarkerKind = kind;
          }
        }
        // The rotation is lifted only to read the unrotated box, then put back
        // before anything else observes the card.
        const authored = card.image.style.transform;
        card.image.style.transform = 'none';
        const untransformedCard = rectOf(card.image);
        card.image.style.transform = authored;
        const cardDetails = captureCard();
        const markers = [
          markerOf(card.image.damageCounter, 'damage'),
          markerOf(card.image.specialCondition, 'specialCondition'),
          markerOf(card.image.abilityCounter, 'ability'),
        ].filter((marker) => marker.present);
        const wrapperDetails: RuntimeMarkerWrapper = {
          id: stackId,
          frameLocalBounds: rectOf(element),
          clientWidth: element.clientWidth,
          clientHeight: element.clientHeight,
          authoredWidthPx: element.style.width
            ? Number.parseFloat(element.style.width)
            : null,
          inlineMarginRight: element.style.marginRight,
          inlineMarginLeft: element.style.marginLeft,
          computedMarginRightPx: Number.parseFloat(computed.marginRight) || 0,
          computedMarginLeftPx: Number.parseFloat(computed.marginLeft) || 0,
          childImageCount: element.querySelectorAll(':scope > img').length,
        };
        const cardBounds = card.image.getBoundingClientRect();
        return {
          name,
          rotationDegrees: rotationOf(card.image),
          card: rectOf(card.image),
          untransformedCard,
          wrapper: rectOf(element),
          wrapperMargins: [
            element.style.marginRight,
            element.style.marginLeft,
            Number.parseFloat(computed.marginRight) || 0,
            Number.parseFloat(computed.marginLeft) || 0,
          ] as const,
          damage: markerOf(card.image.damageCounter, 'damage'),
          specialCondition: markerOf(
            card.image.specialCondition,
            'specialCondition'
          ),
          ability: markerOf(card.image.abilityCounter, 'ability'),
          cardDetails,
          wrapperDetails,
          markers,
          cardOnlyHitOrder: idsAt(
            cardBounds.left + cardBounds.width / 2,
            cardBounds.bottom - 3
          ),
        };
      };

      const initialComputed = getComputedStyle(container());
      const initialCard = {
        frameLocalBounds: rectOf(card.image),
        clientWidth: card.image.clientWidth,
        clientHeight: card.image.clientHeight,
        initialInlineMargins: {
          right: container().style.marginRight,
          left: container().style.marginLeft,
        },
        initialWrapperMargins: [
          container().style.marginRight,
          container().style.marginLeft,
          Number.parseFloat(initialComputed.marginRight) || 0,
          Number.parseFloat(initialComputed.marginLeft) || 0,
        ] as const,
        details: captureCard(),
      };

      addDamageCounter(user, zoneId, 0, damageInitial, false);
      updateDamageCounter(user, zoneId, 0, damageUpdated, false);
      // Only added when the fixture cycles one. The bench fixture marks a card
      // with damage and an ability and never gives it a condition, so adding
      // one would change the stacking this gate is here to measure.
      const paletteTrace: [string, string, string, string][] = [];
      if (specialConditionInputs.length > 0) {
        addSpecialCondition(user, zoneId, 0, false);
        for (const input of specialConditionInputs) {
          updateSpecialCondition(user, zoneId, 0, input, false);
          const node = card.image.specialCondition!;
          const style = getComputedStyle(node);
          paletteTrace.push([
            input,
            node.textContent ?? '',
            style.backgroundColor,
            style.color,
          ]);
        }
      }
      addAbilityCounter(user, zoneId, 0);
      await frames();

      const phases: MarkerPhase[] = [sample(phaseNames[0]!)];
      for (const name of phaseNames.slice(1)) {
        rotateCard(user, zoneId, 0, false, false);
        await frames();
        phases.push(sample(name));
      }

      if (!retainMarkedPaint) {
        removeDamageCounter(user, zoneId, 0, false);
        if (specialConditionInputs.length > 0) {
          removeSpecialCondition(user, zoneId, 0, false);
        }
        removeAbilityCounter(user, zoneId, 0, false);
        await frames();
        const wrapper = container();
        const index = zone.array.indexOf(card);
        if (index >= 0) zone.array.splice(index, 1);
        card.image.remove();
        await frames();
        if (wrapper.isConnected && wrapper.childElementCount === 0) {
          wrapper.remove();
        }
      }

      return {
        initialCard,
        phases,
        paletteTrace,
        cleanup: {
          markerCount: zone.element.querySelectorAll(
            '.self-circle, .opp-circle, .self-ability-counter, .opp-ability-counter'
          ).length,
          cardPointersAreNull:
            !card.image.damageCounter &&
            !card.image.specialCondition &&
            !card.image.abilityCounter,
          wrapperCount: zone.element.querySelectorAll(
            '[data-legacy-runtime-marker-stack-id]'
          ).length,
          cardCount: zone.element.querySelectorAll(
            '[data-legacy-runtime-marker-card-id]'
          ).length,
        },
      };
    },
    {
      user: options.side === 'local' ? 'self' : 'opp',
      zoneId: options.slot,
      damageInitial: options.damageInitial,
      damageUpdated: options.damageUpdated,
      specialConditionInputs: options.specialConditionInputs,
      phaseNames: options.phaseNames,
      cardId: options.cardId ?? `${options.side}-${options.slot}-marker-card`,
      stackId:
        options.stackId ?? `${options.side}-${options.slot}-marker-stack`,
      markerIdsByKind:
        options.markerIdsByKind ??
        ({
          damage: `${options.side}-${options.slot}-damage-marker`,
          specialCondition: `${options.side}-${options.slot}-specialCondition-marker`,
          ability: `${options.side}-${options.slot}-ability-marker`,
        } satisfies Record<MarkerKind, string>),
      preserveOtherSide: options.preserveOtherSide ?? false,
      retainMarkedPaint: options.retainMarkedPaint ?? false,
    }
  );

export type MarkerMovementKind = 'damage' | 'specialCondition' | 'ability';

export interface MarkerMovementMarker {
  readonly id: string;
  readonly kind: MarkerMovementKind;
  readonly nodeStable: boolean;
  readonly parentZoneId: MarkerSlot;
  readonly textContent: string;
  readonly contentEditable: string;
  readonly frameLocalBounds: MarkerRect;
  readonly className: string;
  readonly pointerEvents: string;
  readonly backgroundColor: string;
  readonly color: string;
  readonly zIndex: number;
}

export interface MarkerMovementPhase {
  readonly name: string;
  /** The zone the card is in when this phase is sampled. */
  readonly zone: string;
  readonly zoneId: MarkerSlot;
  /** Which marker kinds the card carries, in a stable order. */
  readonly markerKinds: readonly MarkerMovementKind[];
  readonly activeWrapperCount: number;
  readonly benchWrapperCount: number;
  readonly activeWrapperCountAfterSettle: number;
  readonly benchWrapperCountAfterSettle: number;
  readonly cardId: string;
  readonly cardNodeStable: boolean;
  readonly cardFrameLocalBounds: MarkerRect;
  readonly wrapperId: string;
  readonly wrapperNodeStable: boolean;
  readonly priorWrapperId: string | null;
  readonly sameWrapperAsPrior: boolean | null;
  readonly wrapperCountImmediately: number;
  readonly priorWrapperConnectedImmediately: boolean | null;
  readonly priorWrapperConnectedAfterSettle: boolean | null;
  readonly markerFrameLocalBoundsImmediately: Readonly<
    Partial<Record<MarkerMovementKind, MarkerRect>>
  >;
  readonly markers: readonly MarkerMovementMarker[];
  readonly cardDamageCounterId: string | null;
  readonly cardSpecialConditionId: string | null;
  readonly cardAbilityCounterId: string | null;
}

export interface MarkerMovementCapture {
  readonly id: string;
  readonly phases: readonly MarkerMovementPhase[];
  readonly cleanup: {
    readonly markerCount: number;
    readonly activeWrapperCount: number;
    readonly benchWrapperCount: number;
    readonly cardConnected: boolean;
    readonly cardPointersAreNull: boolean;
  };
}

/**
 * Marks a card in the active slot, demotes it to the bench, reconstructs the
 * board, and promotes it back.
 *
 * What this measures is which markers survive the journey. A special condition
 * belongs to the Active Pokemon, so leaving the active slot drops it while the
 * damage and ability counters follow the card and are reflowed into their new
 * home -- and the fixture records exactly that as a marker-kind list per phase.
 */
export const captureMarkerMovement = async (
  page: Page,
  options: {
    readonly side: MarkerSide;
    readonly damage: string;
    readonly specialCondition: string;
    readonly phaseNames: readonly string[];
  }
): Promise<MarkerMovementCapture> =>
  page.evaluate(
    async ({ side, user, damage, specialCondition, phaseNames }) => {
      const load = (specifier: string): Promise<Record<string, never>> =>
        import(/* @vite-ignore */ specifier);
      const [
        cardModule,
        zoneModule,
        placementModule,
        bundleModule,
        refreshModule,
        damageModule,
        conditionModule,
        abilityModule,
      ] = await Promise.all([
        load('/src/setup/deck-constructor/card.js'),
        load('/src/setup/zones/get-zone.js'),
        load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
        load('/src/actions/move-card-bundle/move-card-bundle.js'),
        load('/src/setup/sizing/refresh-board.js'),
        load('/src/actions/counters/damage-counter.js'),
        load('/src/actions/counters/special-condition.js'),
        load('/src/actions/counters/ability-counter.js'),
      ]);

      interface LegacyImage extends HTMLImageElement {
        damageCounter?: HTMLElement | null;
        specialCondition?: HTMLElement | null;
        abilityCounter?: HTMLElement | null;
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
      const { initializeActiveBenchCard } = placementModule as unknown as {
        readonly initializeActiveBenchCard: (
          user: string,
          card: LegacyCard,
          zoneId: string,
          zone: LegacyZone
        ) => void;
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
      const { refreshBoard } = refreshModule as unknown as {
        readonly refreshBoard: () => void;
      };
      const { addDamageCounter, removeDamageCounter } =
        damageModule as unknown as {
          readonly addDamageCounter: (
            user: string,
            zoneId: string,
            index: number,
            amount: string,
            emit?: boolean
          ) => void;
          readonly removeDamageCounter: (
            user: string,
            zoneId: string,
            index: number,
            emit?: boolean
          ) => void;
        };
      const { addSpecialCondition, updateSpecialCondition } =
        conditionModule as unknown as {
          readonly addSpecialCondition: (
            user: string,
            zoneId: string,
            index: number,
            emit?: boolean
          ) => void;
          readonly updateSpecialCondition: (
            user: string,
            zoneId: string,
            index: number,
            text: string,
            emit?: boolean
          ) => void;
        };
      const { addAbilityCounter, removeAbilityCounter } =
        abilityModule as unknown as {
          readonly addAbilityCounter: (
            user: string,
            zoneId: string,
            index: number
          ) => void;
          readonly removeAbilityCounter: (
            user: string,
            zoneId: string,
            index: number,
            emit?: boolean
          ) => void;
        };

      const clearZone = (owner: string, id: string) => {
        const target = getZone(owner, id);
        target.array.length = 0;
        for (const image of [...target.element.querySelectorAll('img')]) {
          image.remove();
        }
        for (const wrapper of [
          ...target.element.querySelectorAll('.play-container'),
        ]) {
          wrapper.remove();
        }
      };
      for (const owner of ['self', 'opp']) {
        for (const id of ['active', 'bench', 'hand', 'discard']) {
          clearZone(owner, id);
        }
      }
      const active = getZone(user, 'active');
      const bench = getZone(user, 'bench');

      const frames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      const card = new Card(
        user,
        'moved',
        'Pokémon',
        `${location.origin}/src/assets/cardback.png`
      );
      await card.image.decode();
      active.array.push(card);
      initializeActiveBenchCard(user, card, 'active', active);
      for (
        let attempt = 0;
        attempt < 20 && card.image.clientWidth === 0;
        attempt += 1
      ) {
        await frames();
      }
      if (card.image.clientWidth === 0) {
        throw new Error('Real-v1 marker movement card never received layout');
      }

      const wrapperCount = (zone: LegacyZone) =>
        zone.element.querySelectorAll(':scope > .play-container').length;
      const zoneOf = (): MarkerSlot | 'none' =>
        active.array.includes(card)
          ? 'active'
          : bench.array.includes(card)
            ? 'bench'
            : 'none';
      const wrapperOf = (): HTMLElement => {
        const wrapper = card.image.parentElement;
        if (!wrapper) {
          throw new Error('Real-v1 marker movement card has no wrapper');
        }
        return wrapper;
      };
      const wrapperIds = new WeakMap<HTMLElement, string>();
      let wrapperSequence = 0;
      const idOfWrapper = (wrapper: HTMLElement): string => {
        const existing = wrapperIds.get(wrapper);
        if (existing) return existing;
        const id = `${side}-marker-wrapper-${String(++wrapperSequence)}`;
        wrapperIds.set(wrapper, id);
        return id;
      };
      const initialCard = card.image;
      const initialWrapper = wrapperOf();
      idOfWrapper(initialWrapper);
      const cardId = `${side}-marker-movement-card`;
      const markerId = (kind: MarkerMovementKind) =>
        `${side}-marker-movement-${kind}`;
      const rectOf = (node: Element): MarkerRect => {
        const bounds = node.getBoundingClientRect();
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      };

      addDamageCounter(user, 'active', 0, damage, false);
      addSpecialCondition(user, 'active', 0, false);
      updateSpecialCondition(user, 'active', 0, specialCondition, false);
      addAbilityCounter(user, 'active', 0);
      await frames();
      const initialMarkers: Readonly<
        Record<MarkerMovementKind, HTMLElement | null>
      > = {
        damage: card.image.damageCounter ?? null,
        specialCondition: card.image.specialCondition ?? null,
        ability: card.image.abilityCounter ?? null,
      };
      const markerEntries = () =>
        [
          ['damage', card.image.damageCounter],
          ['specialCondition', card.image.specialCondition],
          ['ability', card.image.abilityCounter],
        ] as const;
      const captureMarkers = (): MarkerMovementMarker[] =>
        markerEntries().flatMap(([kind, marker]) => {
          if (!marker?.isConnected) return [];
          const parentZoneId =
            marker.parentElement === active.element
              ? 'active'
              : marker.parentElement === bench.element
                ? 'bench'
                : null;
          if (parentZoneId === null) {
            throw new Error(`Real-v1 ${kind} marker has an unexpected parent`);
          }
          const styles = getComputedStyle(marker);
          return [
            {
              id: markerId(kind),
              kind,
              nodeStable: marker === initialMarkers[kind],
              parentZoneId,
              textContent: marker.textContent ?? '',
              contentEditable: marker.contentEditable,
              frameLocalBounds: rectOf(marker),
              className: marker.className,
              pointerEvents: styles.pointerEvents,
              backgroundColor: styles.backgroundColor,
              color: styles.color,
              zIndex: Number.parseInt(styles.zIndex, 10) || 0,
            },
          ];
        });
      const captureMarkerBounds = () =>
        Object.fromEntries(
          markerEntries().flatMap(([kind, marker]) =>
            marker?.isConnected ? [[kind, rectOf(marker)]] : []
          )
        ) as Readonly<Partial<Record<MarkerMovementKind, MarkerRect>>>;
      const capturePhase = (
        name: string,
        priorWrapper: HTMLElement | null,
        wrapperCountImmediately: number,
        priorWrapperConnectedImmediately: boolean | null,
        markerFrameLocalBoundsImmediately: Readonly<
          Partial<Record<MarkerMovementKind, MarkerRect>>
        >
      ): MarkerMovementPhase => {
        const zoneId = zoneOf();
        if (zoneId === 'none') {
          throw new Error(`Real-v1 marker card has no zone during ${name}`);
        }
        const wrapper = wrapperOf();
        const markers = captureMarkers();
        const activeWrapperCount = wrapperCount(active);
        const benchWrapperCount = wrapperCount(bench);
        return {
          name,
          zone: zoneId,
          zoneId,
          markerKinds: markers.map(({ kind }) => kind),
          activeWrapperCount,
          benchWrapperCount,
          activeWrapperCountAfterSettle: activeWrapperCount,
          benchWrapperCountAfterSettle: benchWrapperCount,
          cardId,
          cardNodeStable: card.image === initialCard,
          cardFrameLocalBounds: rectOf(card.image),
          wrapperId: idOfWrapper(wrapper),
          wrapperNodeStable: wrapper === initialWrapper,
          priorWrapperId:
            priorWrapper === null ? null : idOfWrapper(priorWrapper),
          sameWrapperAsPrior:
            priorWrapper === null ? null : wrapper === priorWrapper,
          wrapperCountImmediately,
          priorWrapperConnectedImmediately,
          priorWrapperConnectedAfterSettle:
            priorWrapper === null ? null : priorWrapper.isConnected,
          markerFrameLocalBoundsImmediately,
          markers,
          cardDamageCounterId: card.image.damageCounter
            ? markerId('damage')
            : null,
          cardSpecialConditionId: card.image.specialCondition
            ? markerId('specialCondition')
            : null,
          cardAbilityCounterId: card.image.abilityCounter
            ? markerId('ability')
            : null,
        };
      };
      const phases: MarkerMovementPhase[] = [
        capturePhase(
          phaseNames[0]!,
          null,
          wrapperCount(active) + wrapperCount(bench),
          null,
          captureMarkerBounds()
        ),
      ];
      const transition = async (
        name: string,
        operation: () => void
      ): Promise<void> => {
        const priorWrapper = wrapperOf();
        idOfWrapper(priorWrapper);
        operation();
        const wrapperCountImmediately =
          wrapperCount(active) + wrapperCount(bench);
        const priorWrapperConnectedImmediately = priorWrapper.isConnected;
        const markerFrameLocalBoundsImmediately = captureMarkerBounds();
        await frames();
        phases.push(
          capturePhase(
            name,
            priorWrapper,
            wrapperCountImmediately,
            priorWrapperConnectedImmediately,
            markerFrameLocalBoundsImmediately
          )
        );
      };

      // Demote to the bench. moveCardBundle refreshes on its own, which is
      // what reflows the counters into their new home.
      await transition(phaseNames[1]!, () =>
        moveCardBundle(user, 'self', 'active', 'bench', 0, -1, 'move', false)
      );
      await transition(phaseNames[2]!, refreshBoard);
      await transition(phaseNames[3]!, () =>
        moveCardBundle(user, 'self', 'bench', 'active', 0, -1, 'move', false)
      );

      const zoneId = zoneOf();
      if (zoneId !== 'none') {
        removeDamageCounter(user, zoneId, 0, false);
        removeAbilityCounter(user, zoneId, 0, false);
      }
      const home = zoneId === 'none' ? active : getZone(user, zoneId);
      const index = home.array.indexOf(card);
      if (index >= 0) {
        home.array.splice(index, 1);
        card.image.parentElement?.remove();
        card.image.remove();
      }
      await frames();

      return {
        id: `${side}-marker-movement`,
        phases,
        cleanup: {
          markerCount: Object.values(initialMarkers).filter(
            (marker) => marker?.isConnected
          ).length,
          activeWrapperCount: wrapperCount(active),
          benchWrapperCount: wrapperCount(bench),
          cardConnected: card.image.isConnected,
          cardPointersAreNull:
            !card.image.damageCounter &&
            !card.image.specialCondition &&
            !card.image.abilityCounter,
        },
      };
    },
    {
      side: options.side,
      user: options.side === 'local' ? 'self' : 'opp',
      damage: options.damage,
      specialCondition: options.specialCondition,
      phaseNames: options.phaseNames,
    }
  );
