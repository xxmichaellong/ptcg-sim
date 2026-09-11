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
  readonly role: string;
  readonly frameLocalBounds: Rect;
  readonly inlineLeft: string;
  readonly inlineBottom: string;
  readonly inlineTransform: string;
  readonly zIndex: string;
  readonly clientWidth: number;
  readonly clientHeight: number;
}

export interface ReflowStack {
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
}

export interface ReflowCapture {
  readonly cards: readonly ReflowCard[];
  readonly stack: ReflowStack;
  /** Container width after each attachment, before the next one lands. */
  readonly attachmentClientWidthsBefore: readonly number[];
  readonly attachmentAuthoredWidthsPx: readonly number[];
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
  }
): Promise<ReflowCapture> =>
  page.evaluate(
    async ({ user, zoneId, evolutionOrder, attachmentOrder, typeByRole }) => {
      const load = (specifier: string): Promise<Record<string, never>> =>
        import(/* @vite-ignore */ specifier);
      const [cardModule, zoneModule, bundleModule] = await Promise.all([
        load('/src/setup/deck-constructor/card.js'),
        load('/src/setup/zones/get-zone.js'),
        load('/src/actions/move-card-bundle/move-card-bundle.js'),
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

      // Both sides are cleared, not just the acting one. `refreshBoard`
      // rebuilds the whole board, so a stack left behind by an earlier capture
      // on the other side takes part in this one's reflow.
      for (const owner of ['self', 'opp']) {
        for (const id of ['active', 'bench', 'hand']) {
          const other = getZone(owner, id);
          other.array.length = 0;
          other.element.replaceChildren();
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

      const container = (): HTMLElement =>
        byRole.get(first!)!.image.parentElement as HTMLElement;

      const { refreshBoard } = (await load(
        '/src/setup/sizing/refresh-board.js'
      )) as unknown as { readonly refreshBoard: () => void };

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

      // The fixtures record an attachment landing on a settled stack, so the
      // "before" measurement is taken against one.
      await settle();

      const attachmentClientWidthsBefore: number[] = [];
      const attachmentAuthoredWidthsPx: number[] = [];
      for (const role of attachmentOrder) {
        attachmentClientWidthsBefore.push(container().clientWidth);
        const card = await make(role);
        byRole.set(role, card);
        // Attachments always target the stack's own base, which is where v1
        // anchors an Energy or Tool regardless of how tall the stack is.
        await play(card, indexOf(first!));
        attachmentAuthoredWidthsPx.push(
          Number.parseFloat(container().style.width)
        );
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

      return {
        cards: [...byRole].map(([role, card]) => ({
          role,
          frameLocalBounds: rectOf(card.image),
          inlineLeft: card.image.style.left,
          inlineBottom: card.image.style.bottom,
          inlineTransform: card.image.style.transform,
          zIndex: card.image.style.zIndex,
          clientWidth: card.image.clientWidth,
          clientHeight: card.image.clientHeight,
        })),
        stack: {
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
        },
        attachmentClientWidthsBefore,
        attachmentAuthoredWidthsPx,
      };
    },
    {
      user: options.side === 'local' ? 'self' : 'opp',
      zoneId: options.slot,
      evolutionOrder: options.evolutionOrder,
      attachmentOrder: options.attachmentOrder,
      typeByRole: CARD_TYPE_BY_ROLE,
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
