import type { Locator, Page } from '@playwright/test';

import { loadLegacyRuntime } from './legacy-runtime.js';

export interface CapturedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type LegacyContainedCardKind =
  'deck' | 'discard' | 'lostZone' | 'stadium';

export type LegacyContainedCardSide = 'local' | 'opponent';

export interface LegacyContainedCardFixtureCard {
  readonly id: string;
  readonly kind: LegacyContainedCardKind;
  readonly side: LegacyContainedCardSide | 'shared';
  readonly readableBy: LegacyContainedCardSide;
  readonly physicalBounds: CapturedRect;
  readonly containerBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly enclosingRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly objectFit: string;
  readonly maxWidth: string;
  readonly maxHeight: string;
  readonly sourcePath: string;
}

export interface LegacyRuntimeContainedCardFixture {
  readonly cards: readonly LegacyContainedCardFixtureCard[];
  readonly sourceFulfillment: {
    readonly servedPaths: readonly string[];
    readonly blockedExternalOrigins: readonly string[];
    readonly missingSameOriginPaths: readonly string[];
  };
}

interface RuntimeCard {
  readonly image: HTMLImageElement;
}

interface RuntimeZone {
  readonly array: RuntimeCard[];
  readonly element: HTMLElement;
  readonly elementCover?: HTMLElement;
}

interface RuntimeSystemState {
  cardBackSrc: string;
  p1OppCardBackSrc: string;
  p2OppCardBackSrc: string;
  isTwoPlayer: boolean;
}

type RuntimeCardConstructor = new (
  user: string,
  name: string,
  type: string,
  imageUrl: string
) => RuntimeCard;

type RuntimeGetZone = (user: string, zoneId: string) => RuntimeZone;

type RuntimeMoveCard = (
  user: string,
  initiator: string,
  originZoneId: string,
  destinationZoneId: string,
  index: number
) => void;

const requireRect = async (
  locator: Locator,
  label: string
): Promise<CapturedRect> => {
  const bounds = await locator.boundingBox();
  if (!bounds)
    throw new Error(`Legacy runtime target is not visible: ${label}`);
  return bounds;
};

const captureRotationDegrees = async (locator: Locator): Promise<number> =>
  locator.evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    const matrix =
      transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(transform);
    return ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360;
  });

const captureContainedCard = async (
  locator: Locator,
  container: Locator,
  input: Pick<LegacyContainedCardFixtureCard, 'kind' | 'side' | 'readableBy'>,
  ancestorRotationDegrees = 0
): Promise<LegacyContainedCardFixtureCard> => {
  const [physicalBounds, containerBounds, containerRotationDegrees] =
    await Promise.all([
      requireRect(locator, `${input.side} ${input.kind} contained card`),
      requireRect(container, `${input.side} ${input.kind} container`),
      captureRotationDegrees(container),
    ]);
  const details = await locator.evaluate((element) => {
    // v1 constructs these images in the top document and then adopts them into
    // a player iframe, so an iframe-realm instanceof check is false.
    if (element.tagName !== 'IMG') {
      throw new Error('Legacy runtime contained-card target must be an image');
    }
    const image = element as HTMLImageElement;
    const styles = getComputedStyle(image);
    const transform =
      styles.transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(styles.transform);
    return {
      id: image.dataset.legacyContainedCardId ?? '',
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      localRotationDegrees:
        ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) % 360,
      objectFit: styles.objectFit,
      maxWidth: styles.maxWidth,
      maxHeight: styles.maxHeight,
      sourcePath: new URL(image.currentSrc).pathname,
    };
  });
  return {
    ...input,
    ...details,
    physicalBounds,
    containerBounds,
    enclosingRotationDegrees:
      (ancestorRotationDegrees + containerRotationDegrees) % 360,
    effectiveRotationDegrees:
      (details.localRotationDegrees +
        ancestorRotationDegrees +
        containerRotationDegrees) %
      360,
  };
};

const mountRuntimePileCoversAndLocalStadium = async (
  page: Page
): Promise<void> => {
  await page.evaluate(async () => {
    const load = (specifier: string): Promise<Record<string, unknown>> =>
      import(/* @vite-ignore */ specifier);
    const [frontEnd, cardModule, zoneModule, moveCardModule] =
      await Promise.all([
        load('/src/front-end.js'),
        load('/src/setup/deck-constructor/card.js'),
        load('/src/setup/zones/get-zone.js'),
        load('/src/actions/move-card-bundle/move-card.js'),
      ]);
    const Card = cardModule['Card'] as RuntimeCardConstructor;
    const getZone = zoneModule['getZone'] as RuntimeGetZone;
    const moveCard = moveCardModule['moveCard'] as RuntimeMoveCard;
    const systemState = frontEnd['systemState'] as RuntimeSystemState;
    const cardImageUrl = `${location.origin}/src/assets/cardback.png`;
    const alternateBackUrl = `${location.origin}/src/assets/blank-logo.png`;

    systemState.cardBackSrc = cardImageUrl;
    systemState.p1OppCardBackSrc = cardImageUrl;
    systemState.p2OppCardBackSrc = cardImageUrl;
    systemState.isTwoPlayer = false;

    for (const user of ['self', 'opp']) {
      for (const zoneId of ['deck', 'discard', 'lostZone', 'hand']) {
        const zone = getZone(user, zoneId);
        zone.array.splice(0);
        for (const image of zone.element.querySelectorAll('img'))
          image.remove();
        zone.elementCover?.replaceChildren();
      }
    }
    const stadium = getZone('neutral', 'stadium');
    stadium.array.splice(0);
    for (const image of stadium.element.querySelectorAll('img')) image.remove();

    const addThroughRuntime = async (
      user: 'self' | 'opp',
      destination: 'deck' | 'discard' | 'lostZone' | 'stadium',
      name: string
    ): Promise<RuntimeCard> => {
      // v1's revealCard treats a face URL equal to the configured card back as
      // an already-hidden card. Give deck contents a different face while its
      // production cover uses cardImageUrl; for face-up zones, use an
      // alternate configured back so the visible face remains cardImageUrl.
      const cardBackUrl =
        destination === 'deck' ? cardImageUrl : alternateBackUrl;
      systemState.cardBackSrc = cardBackUrl;
      systemState.p1OppCardBackSrc = cardBackUrl;
      systemState.p2OppCardBackSrc = cardBackUrl;
      const faceUrl = destination === 'deck' ? alternateBackUrl : cardImageUrl;
      const card = new Card(user, name, 'Trainer', faceUrl);
      await card.image.decode();
      const hand = getZone(user, 'hand');
      hand.array.push(card);
      hand.element.append(card.image);
      moveCard(user, 'self', 'hand', destination, hand.array.length - 1);
      return card;
    };

    for (const user of ['self', 'opp'] as const) {
      for (const destination of ['deck', 'discard', 'lostZone'] as const) {
        await addThroughRuntime(
          user,
          destination,
          `${user} ${destination} contained-card fixture`
        );
        const cover = getZone(user, destination).elementCover
          ?.firstElementChild;
        if (!(cover instanceof HTMLImageElement)) {
          throw new Error(
            `Real v1 did not create ${user} ${destination} cover`
          );
        }
        const side = user === 'self' ? 'local' : 'opponent';
        cover.dataset.legacyContainedCardId = `${side}-${destination}-cover`;
      }
    }

    const localStadium = await addThroughRuntime(
      'self',
      'stadium',
      'self stadium contained-card fixture'
    );
    localStadium.image.dataset.legacyContainedCardId = 'shared-stadium';

    const images = [
      ...document.querySelectorAll<HTMLImageElement>(
        '[data-legacy-contained-card-id]'
      ),
      ...[...document.querySelectorAll<HTMLIFrameElement>('iframe')].flatMap(
        (frame) => [
          ...(frame.contentDocument?.querySelectorAll<HTMLImageElement>(
            '[data-legacy-contained-card-id]'
          ) ?? []),
        ]
      ),
    ];
    await Promise.all(images.map((image) => image.decode()));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  });
};

const replaceLocalWithOpponentStadium = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const load = (specifier: string): Promise<Record<string, unknown>> =>
      import(/* @vite-ignore */ specifier);
    const [frontEnd, cardModule, zoneModule, moveCardModule] =
      await Promise.all([
        load('/src/front-end.js'),
        load('/src/setup/deck-constructor/card.js'),
        load('/src/setup/zones/get-zone.js'),
        load('/src/actions/move-card-bundle/move-card.js'),
      ]);
    const Card = cardModule['Card'] as RuntimeCardConstructor;
    const getZone = zoneModule['getZone'] as RuntimeGetZone;
    const moveCard = moveCardModule['moveCard'] as RuntimeMoveCard;
    const systemState = frontEnd['systemState'] as RuntimeSystemState;
    const stadium = getZone('neutral', 'stadium');
    const localStadium = stadium.array[0];
    if (!localStadium) throw new Error('Missing real v1 local stadium card');
    delete localStadium.image.dataset.legacyContainedCardId;
    moveCard('self', 'self', 'stadium', 'discard', 0);

    const imageUrl = `${location.origin}/src/assets/cardback.png`;
    const alternateBackUrl = `${location.origin}/src/assets/blank-logo.png`;
    systemState.cardBackSrc = alternateBackUrl;
    systemState.p1OppCardBackSrc = alternateBackUrl;
    systemState.p2OppCardBackSrc = alternateBackUrl;
    const opponentStadium = new Card(
      'opp',
      'opponent stadium contained-card fixture',
      'Trainer',
      imageUrl
    );
    await opponentStadium.image.decode();
    const hand = getZone('opp', 'hand');
    hand.array.push(opponentStadium);
    hand.element.append(opponentStadium.image);
    moveCard('opp', 'self', 'hand', 'stadium', hand.array.length - 1);
    opponentStadium.image.dataset.legacyContainedCardId = 'shared-stadium';

    const selfDiscardCover = getZone('self', 'discard').elementCover
      ?.firstElementChild;
    if (!(selfDiscardCover instanceof HTMLImageElement)) {
      throw new Error('Real v1 did not preserve the self discard cover');
    }
    selfDiscardCover.dataset.legacyContainedCardId = 'local-discard-cover';

    await Promise.all(
      [opponentStadium.image, selfDiscardCover].map((image) => image.decode())
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  });
};

/**
 * Measures contained pile covers and both stadium-owner orientations after the
 * checked-in v1 Card, Cover, moveCard, updateCover, and updateStadiumCard
 * implementations have created them. No board mutation is transcribed here.
 */
export const captureLegacyRuntimeContainedCardFixture = async (
  page: Page
): Promise<LegacyRuntimeContainedCardFixture> => {
  const loaded = await loadLegacyRuntime(page);
  await mountRuntimePileCoversAndLocalStadium(page);

  const localStadium = await captureContainedCard(
    page.locator('[data-legacy-contained-card-id="shared-stadium"]'),
    page.locator('#stadium'),
    { kind: 'stadium', side: 'shared', readableBy: 'local' }
  );

  await replaceLocalWithOpponentStadium(page);

  const frameRotations = {
    local: await captureRotationDegrees(page.locator('#selfContainer')),
    opponent: await captureRotationDegrees(page.locator('#oppContainer')),
  };
  const cards: LegacyContainedCardFixtureCard[] = [];
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const frame = page.frameLocator(frameSelector);
    for (const [kind, selector] of [
      ['lostZone', '#lostZoneCover'],
      ['deck', '#deckCover'],
      ['discard', '#discardCover'],
    ] as const) {
      cards.push(
        await captureContainedCard(
          frame.locator(
            `[data-legacy-contained-card-id="${side}-${kind}-cover"]`
          ),
          frame.locator(`div${selector}`),
          { kind, side, readableBy: side },
          frameRotations[side]
        )
      );
    }
  }
  cards.push(localStadium);
  cards.push(
    await captureContainedCard(
      page.locator('[data-legacy-contained-card-id="shared-stadium"]'),
      page.locator('#stadium'),
      { kind: 'stadium', side: 'shared', readableBy: 'opponent' }
    )
  );

  return {
    cards,
    sourceFulfillment: {
      servedPaths: loaded.servedPaths,
      blockedExternalOrigins: loaded.blockedOrigins,
      missingSameOriginPaths: loaded.missingPaths,
    },
  };
};
