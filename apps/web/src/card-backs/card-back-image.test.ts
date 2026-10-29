import { asPlayerId, asViewCardId } from '@ptcgsim/game-core';
import type { BoardScene, CardSceneNode } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { cardBackImage, resolveSceneCardBacks } from './card-back-image.js';
import { STANDARD_CARD_BACK_IMAGE } from './card-back-presets.js';

const sha = 'd'.repeat(64);
const mine = { own: true, opponentCustomBacks: false };
const theirs = { own: false, opponentCustomBacks: true };
const theirsHidden = { own: false, opponentCustomBacks: false };

describe('cardBackImage', () => {
  it('draws presets for everyone, the old default path as the standard back', () => {
    for (const viewer of [mine, theirs, theirsHidden]) {
      expect(cardBackImage('preset:azure', viewer)).toBe(
        '/v2/assets/backs/azure.2af4a6791c.webp'
      );
      expect(cardBackImage('/v2/assets/cardback.png', viewer)).toBe(
        STANDARD_CARD_BACK_IMAGE
      );
      expect(cardBackImage(undefined, viewer)).toBe(STANDARD_CARD_BACK_IMAGE);
      // A preset this client doesn't know (a newer one's): the standard.
      expect(cardBackImage('preset:aurora', viewer)).toBe(
        STANDARD_CARD_BACK_IMAGE
      );
    }
  });

  it("draws uploaded and designed backs from our own origin, an opponent's only while allowed", () => {
    expect(cardBackImage(`img:${sha}`, mine)).toBe(`/v2/images/${sha}`);
    expect(cardBackImage(`img:${sha}`, theirs)).toBe(`/v2/images/${sha}`);
    expect(cardBackImage(`img:${sha}`, theirsHidden)).toBe(
      STANDARD_CARD_BACK_IMAGE
    );
    const design = 'design:1.navy.stripes.gold.ball';
    expect(cardBackImage(design, theirs)).toMatch(/^data:image\/svg\+xml,/u);
    expect(cardBackImage(design, theirsHidden)).toBe(STANDARD_CARD_BACK_IMAGE);
  });

  it('never loads a legacy URL back on the table, not even its owner (ADR-041)', () => {
    for (const legacy of [
      'https://tracker.example/pixel.png?game=42',
      'url:https://tracker.example/pixel.png',
    ]) {
      expect(cardBackImage(legacy, mine), legacy).toBe(
        STANDARD_CARD_BACK_IMAGE
      );
      expect(cardBackImage(legacy, theirs), legacy).toBe(
        STANDARD_CARD_BACK_IMAGE
      );
      // Its owner's own deck screen shows it, to import it.
      expect(
        cardBackImage(legacy, { ...mine, ownDeckScreen: true }),
        legacy
      ).toBe(
        'https://tracker.example/pixel.png' +
          (legacy.startsWith('url:') ? '' : '?game=42')
      );
      expect(
        cardBackImage(legacy, { ...theirs, ownDeckScreen: true }),
        legacy
      ).toBe(STANDARD_CARD_BACK_IMAGE);
    }
    expect(cardBackImage('img:not-a-hash', mine)).toBe(
      STANDARD_CARD_BACK_IMAGE
    );
  });
});

describe('resolveSceneCardBacks', () => {
  const blue = asPlayerId('blue');
  const red = asPlayerId('red');
  const card = (
    id: string,
    ownerId: typeof blue,
    fields: Partial<CardSceneNode>
  ): CardSceneNode =>
    ({
      id: asViewCardId(id),
      ownerId,
      parentId: `zone:${id}`,
      side: 'local',
      role: 'zone',
      bounds: { x: 0, y: 0, width: 10, height: 14 },
      zIndex: 1,
      rotationQuarterTurns: 0,
      imageUrl: '/face.png',
      concealed: false,
      label: id,
      interactive: true,
      renderKey: `card:${id}`,
      ...fields,
    }) as CardSceneNode;
  const scene = (cards: CardSceneNode[]) =>
    ({ cards, zones: [], markers: [], counts: [] }) as unknown as BoardScene;

  it('draws each back for this viewer and leaves faces alone', () => {
    const face = card('face', blue, { imageUrl: '/face.png' });
    const myHidden = card('mine', blue, {
      concealed: true,
      imageUrl: `img:${sha}`,
    });
    const theirHidden = card('theirs', red, {
      concealed: true,
      imageUrl: `img:${sha}`,
    });
    // A deck's cover is its back, though its owner may know its top card.
    const myDeck = card('deck', blue, {
      imageUrl: '/top-card.png',
      tableImageUrl: 'https://outside.example/back.png',
    });
    const resolved = resolveSceneCardBacks(
      scene([face, myHidden, theirHidden, myDeck]),
      { ownPlayerIds: new Set([blue]), opponentCustomBacks: false }
    );
    const [faceOut, mineOut, theirsOut, deckOut] = resolved.cards;
    expect(faceOut).toBe(face);
    expect(mineOut).toMatchObject({
      imageUrl: `/v2/images/${sha}`,
      backFallbackUrl: STANDARD_CARD_BACK_IMAGE,
    });
    expect(theirsOut).toMatchObject({
      imageUrl: STANDARD_CARD_BACK_IMAGE,
      backFallbackUrl: STANDARD_CARD_BACK_IMAGE,
    });
    expect(deckOut).toMatchObject({
      imageUrl: '/top-card.png',
      tableImageUrl: STANDARD_CARD_BACK_IMAGE,
    });
  });

  it('keeps a scene without backs as it is', () => {
    const original = scene([card('face', blue, {})]);
    expect(
      resolveSceneCardBacks(original, {
        ownPlayerIds: new Set([blue]),
        opponentCustomBacks: true,
      })
    ).toBe(original);
  });
});
