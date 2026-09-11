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
      //
      // Only cards are removed, never the element's other children: a zone
      // container also holds v1's own controls, and `sort` reads the discard
      // zone's sort checkbox out of it.
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

/** One sampled moment of a stack, superset of what any phase records. */
export interface DepartureSample {
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
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
}

export interface RemovedCardState {
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly zIndex: string;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly energyLayer: number;
  readonly layer: number;
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
    /** Frame-local points to hit-test, per phase and region. */
    readonly hitPoints: Readonly<
      Record<string, Readonly<Record<string, { x: number; y: number }>>>
    >;
  }
): Promise<DepartureCapture> =>
  page.evaluate(
    async ({
      user,
      zoneId,
      departure,
      attachmentOrder,
      typeByRole,
      hitPoints,
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
      const numeric = (value: string) => Number.parseFloat(value) || 0;
      let supersededWrapper: HTMLElement | null = null;
      const sample = (): DepartureSample => {
        const element = container();
        const bounds = element.getBoundingClientRect();
        const images = [...element.querySelectorAll('img')];
        const xByRole: Record<string, number> = {};
        const leftByRole: Record<string, number> = {};
        const zByRole: Record<string, number> = {};
        for (const image of images) {
          const role = roleOf(image);
          xByRole[role] = image.getBoundingClientRect().x;
          leftByRole[role] = numeric(image.style.left);
          zByRole[role] = Number.parseInt(image.style.zIndex, 10) || 0;
        }
        return {
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
          roleLogicalOrder: zone.array.map((card) => card.name),
          observedWrapperCount: zone.element.querySelectorAll(
            ':scope > .play-container'
          ).length,
          supersededWrapperConnected: Boolean(
            supersededWrapper?.isConnected && supersededWrapper !== element
          ),
        };
      };
      const hitOrder = (
        phase: string
      ): Readonly<Record<string, readonly string[]>> => {
        const points = hitPoints[phase];
        if (!points) return {};
        const known = new Set([...byRole.values()].map((card) => card.image));
        const result: Record<string, readonly string[]> = {};
        for (const [region, point] of Object.entries(points)) {
          result[region] = (
            base.image.ownerDocument.elementsFromPoint(
              point.x,
              point.y
            ) as Element[]
          )
            .filter((node) => known.has(node as LegacyImage))
            .map(roleOf);
        }
        return result;
      };

      const hitOrderByPhaseAndRegion: Record<
        string,
        Readonly<Record<string, readonly string[]>>
      > = {};
      const stablePreDeparture = sample();
      hitOrderByPhaseAndRegion['stablePreDeparture'] =
        hitOrder('stablePreDeparture');

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
      hitOrderByPhaseAndRegion['transientPostDeparture'] = hitOrder(
        'transientPostDeparture'
      );

      // Sampled synchronously, with no frame awaited. The reconstruction
      // leaves the superseded wrapper connected alongside its replacement
      // until v1's empty-wrapper observer runs, which is the whole of what
      // this phase records -- waiting a frame first would only ever show the
      // settled board.
      refreshBoard();
      const synchronousPostRefresh = sample();
      hitOrderByPhaseAndRegion['synchronousPostRefresh'] = hitOrder(
        'synchronousPostRefresh'
      );

      await settle();
      supersededWrapper = null;
      const stablePostRefresh = sample();
      hitOrderByPhaseAndRegion['stablePostRefresh'] =
        hitOrder('stablePostRefresh');

      const removedImage = departing.image;
      const removedCardAfterDeparture: RemovedCardState = {
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
        energyLayer: removedImage.energyLayer ?? 0,
        layer: removedImage.layer ?? 0,
        sinkConnected: removedImage.isConnected,
        parentIsDepartureSink: removedImage.parentElement === sink.element,
      };

      // Clearing the board is part of what the fixture records: nothing of the
      // case may survive into the next one.
      for (const id of ['active', 'bench', 'hand']) clearZone(user, id);
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
      hitPoints: options.hitPoints,
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
