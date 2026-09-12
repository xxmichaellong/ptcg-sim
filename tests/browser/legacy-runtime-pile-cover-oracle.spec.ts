import { expect, test } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/contained-card-layout-v1.json' with { type: 'json' };
import { withLegacyRuntimePage } from './support/legacy-runtime-compound-replay.js';

/**
 * Which card a closed pile shows on top.
 *
 * The fixture states this as four words -- deck `first`, discard and lost zone
 * `last`, stadium `only` -- and those words carry real asymmetries in v1:
 *
 * - A deck cover is built once, when the deck receives its first card, and from
 *   the card *back* rather than that card's face. Later arrivals never touch
 *   it, which is what makes the pile read as face-down however many cards land
 *   on it.
 * - Discard and lost-zone covers are rebuilt on every arrival from the newest
 *   card's own image, so the pile shows what was discarded last -- and taking
 *   the top card back off restores the one beneath it.
 * - A stadium holds exactly one card: playing a second discards the first.
 *
 * Recorded from the since-retired TypeScript transcription of v1 and asserted
 * against that same transcription, so none of it could fail before. The digests this fixture
 * carries are checked separately in the unit lane.
 */
test('the recorded pile-cover semantics match the real v1 runtime', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );

  await withLegacyRuntimePage(page, oracle.input.viewport, async () => {
    const result = await page.evaluate(async () => {
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
        readonly elementCover?: HTMLElement;
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

      const zones = ['hand', 'deck', 'discard', 'lostZone', 'stadium'];
      for (const id of zones) {
        const zone = getZone('self', id);
        zone.array.length = 0;
        for (const image of [...zone.element.querySelectorAll('img')]) {
          image.remove();
        }
        zone.elementCover?.replaceChildren();
      }
      const hand = getZone('self', 'hand');
      const frames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );

      // Distinct sources per card, so "which card is on top" is answerable by
      // reading the cover's own src. The harness serves by path and ignores
      // the query, so every one of these is the same checked-in asset.
      const make = async (name: string): Promise<LegacyCard> => {
        const card = new Card(
          'self',
          name,
          'Pokémon',
          `${location.origin}/src/assets/cardback.png?card=${name}`
        );
        await card.image.decode();
        return card;
      };
      const playInto = async (zoneId: string, name: string) => {
        const card = await make(name);
        hand.array.push(card);
        hand.element.append(card.image);
        moveCardBundle(
          'self',
          'self',
          'hand',
          zoneId,
          hand.array.length - 1,
          -1,
          'play',
          false
        );
        await frames();
        return card;
      };
      const coverSrc = (zoneId: string): string | null => {
        const zone = getZone('self', zoneId);
        const image = zone.elementCover?.firstElementChild;
        return image instanceof HTMLImageElement ? image.src : null;
      };
      const nameFromSrc = (src: string | null): string | null => {
        if (src === null) return null;
        const query = new URL(src).searchParams.get('card');
        return query ?? 'card-back';
      };

      const coverNode = (zoneId: string): Element | null =>
        getZone('self', zoneId).elementCover?.firstElementChild ?? null;

      const deckOrder: (string | null)[] = [];
      // Node identity, not just the src: a deck cover is always a card back,
      // so rebuilding it on every arrival would look identical by src alone.
      let deckCoverFirstNode: Element | null = null;
      let deckCoverRebuilds = 0;
      for (const name of ['deck-1', 'deck-2', 'deck-3']) {
        await playInto('deck', name);
        deckOrder.push(nameFromSrc(coverSrc('deck')));
        const node = coverNode('deck');
        if (deckCoverFirstNode === null) {
          deckCoverFirstNode = node;
        } else if (node !== deckCoverFirstNode) {
          deckCoverRebuilds += 1;
        }
      }

      const discardOrder: (string | null)[] = [];
      for (const name of ['discard-1', 'discard-2', 'discard-3']) {
        await playInto('discard', name);
        discardOrder.push(nameFromSrc(coverSrc('discard')));
      }
      // Taking the newest card back off must reveal the one beneath it.
      const discard = getZone('self', 'discard');
      moveCardBundle(
        'self',
        'self',
        'discard',
        'hand',
        discard.array.length - 1,
        -1,
        'take',
        false
      );
      await frames();
      const discardAfterRemoval = nameFromSrc(coverSrc('discard'));

      const lostZoneOrder: (string | null)[] = [];
      for (const name of ['lost-1', 'lost-2']) {
        await playInto('lostZone', name);
        lostZoneOrder.push(nameFromSrc(coverSrc('lostZone')));
      }

      await playInto('stadium', 'stadium-1');
      const stadiumAfterFirst = getZone('self', 'stadium').array.length;
      await playInto('stadium', 'stadium-2');
      const stadium = getZone('self', 'stadium');

      return {
        deckOrder,
        deckCoverRebuilds,
        discardOrder,
        discardAfterRemoval,
        lostZoneOrder,
        stadiumAfterFirst,
        stadiumCount: stadium.array.length,
        stadiumRemaining: stadium.array.map((card) => card.name),
      };
    });

    // `deck: first` -- built once, from the card back, and never rebuilt.
    expect(oracle.pileTop.deck, 'fixture records deck-first').toBe('first');
    expect(result.deckOrder, 'deck cover never follows later arrivals').toEqual(
      ['card-back', 'card-back', 'card-back']
    );
    // The src alone cannot show this: a rebuilt deck cover is another card
    // back. Only the node's identity distinguishes "built once" from "rebuilt
    // every time".
    expect(
      result.deckCoverRebuilds,
      'deck cover is built once and never rebuilt'
    ).toBe(0);

    // `discard: last` / `lostZone: last` -- rebuilt from the newest card.
    expect(oracle.pileTop.discard, 'fixture records discard-last').toBe('last');
    expect(
      result.discardOrder,
      'discard cover follows the newest card'
    ).toEqual(['discard-1', 'discard-2', 'discard-3']);
    expect(
      result.discardAfterRemoval,
      'removing the top discard reveals the card beneath'
    ).toBe('discard-2');

    expect(oracle.pileTop.lostZone, 'fixture records lost-zone-last').toBe(
      'last'
    );
    expect(
      result.lostZoneOrder,
      'lost zone cover follows the newest card'
    ).toEqual(['lost-1', 'lost-2']);

    // `stadium: only` -- a second stadium replaces the first.
    expect(oracle.pileTop.stadium, 'fixture records stadium-only').toBe('only');
    expect(result.stadiumAfterFirst, 'first stadium occupies the slot').toBe(1);
    expect(result.stadiumCount, 'a stadium holds exactly one card').toBe(1);
    expect(
      result.stadiumRemaining,
      'the newer stadium is the one left in play'
    ).toEqual(['stadium-2']);
  });
});
