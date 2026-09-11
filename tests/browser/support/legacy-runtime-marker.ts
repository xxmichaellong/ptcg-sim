import type { Page } from '@playwright/test';

export type MarkerSide = 'local' | 'opponent';
export type MarkerSlot = 'active' | 'bench';

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
  readonly present: boolean;
  readonly bounds: MarkerRect;
  readonly textContent: string;
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
  };
  readonly phases: readonly MarkerPhase[];
  /** `[input, textContent, backgroundColor, color]` per special condition. */
  readonly paletteTrace: readonly (readonly [string, string, string, string])[];
  readonly cleanup: {
    readonly markerCount: number;
    readonly cardPointersAreNull: boolean;
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
      for (const owner of ['self', 'opp']) {
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

      const container = (): HTMLElement =>
        card.image.parentElement as HTMLElement;
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
      const markerOf = (node: MarkerElement | null | undefined) => {
        if (!node) {
          return {
            present: false,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            textContent: '',
            inlineLeftPx: null,
            inlineTopPx: null,
            inlineRightPx: null,
            inlineBottomPx: null,
            inlineWidthPx: null,
            inlineHeightPx: null,
            inlineLineHeightPx: null,
            inlineFontSizePx: null,
          };
        }
        return {
          present: true,
          bounds: rectOf(node),
          textContent: node.textContent ?? '',
          inlineLeftPx: inline(node, 'left'),
          inlineTopPx: inline(node, 'top'),
          inlineRightPx: inline(node, 'right'),
          inlineBottomPx: inline(node, 'bottom'),
          inlineWidthPx: inline(node, 'width'),
          inlineHeightPx: inline(node, 'height'),
          inlineLineHeightPx: inline(node, 'line-height'),
          inlineFontSizePx: inline(node, 'font-size'),
        };
      };
      const rotationOf = (image: LegacyImage) =>
        Number.parseInt(image.style.transform.replace(/[^0-9-]/gu, ''), 10) ||
        0;
      const sample = (name: string): MarkerPhase => {
        const element = container();
        const computed = getComputedStyle(element);
        // The rotation is lifted only to read the unrotated box, then put back
        // before anything else observes the card.
        const authored = card.image.style.transform;
        card.image.style.transform = 'none';
        const untransformedCard = rectOf(card.image);
        card.image.style.transform = authored;
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
          damage: markerOf(card.image.damageCounter),
          specialCondition: markerOf(card.image.specialCondition),
          ability: markerOf(card.image.abilityCounter),
        };
      };

      const initialCard = {
        frameLocalBounds: rectOf(card.image),
        clientWidth: card.image.clientWidth,
        clientHeight: card.image.clientHeight,
        initialInlineMargins: {
          right: container().style.marginRight,
          left: container().style.marginLeft,
        },
      };

      addDamageCounter(user, zoneId, 0, damageInitial, false);
      updateDamageCounter(user, zoneId, 0, damageUpdated, false);
      addSpecialCondition(user, zoneId, 0, false);
      const paletteTrace: [string, string, string, string][] = [];
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
      addAbilityCounter(user, zoneId, 0);
      await frames();

      const phases: MarkerPhase[] = [sample(phaseNames[0]!)];
      for (const name of phaseNames.slice(1)) {
        rotateCard(user, zoneId, 0, false, false);
        await frames();
        phases.push(sample(name));
      }

      removeDamageCounter(user, zoneId, 0, false);
      removeSpecialCondition(user, zoneId, 0, false);
      removeAbilityCounter(user, zoneId, 0, false);
      await frames();

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
    }
  );
