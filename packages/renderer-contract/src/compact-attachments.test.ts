import { describe, expect, it } from 'vitest';
import { asViewCardId } from '@ptcgsim/game-core';
import {
  basicAttachmentEnergyIndex,
  compactAttachmentSlots,
} from './compact-attachments.js';
import { createRendererSpikeView } from './spike-fixture.js';
import { createBoardScene } from './scene.js';
import {
  createTableLayoutSnapshot,
  tableVerticalLayout,
} from './layout-table.js';
import { withHeldCards } from './held-cards.js';
import { DEFAULT_BOARD_PRESENTATION } from './defaults.js';
describe('compact attachments', () => {
  it.each([
    'Grass Energy',
    'Basic Fire Energy',
    'Psychic Energy',
    'Basic Metal Energy',
    'Basic {M} Energy',
    '{P} Energy',
  ])('uses type icons for unambiguous Basic Energy: %s', (name) =>
    expect(basicAttachmentEnergyIndex(name)).toBeTypeOf('number')
  );
  it.each([
    'Double Colorless Energy',
    'Rainbow Energy',
    'Capture Energy',
    'Luminous Energy',
    'Tool',
    'Holon Electrode',
    'Metal Energy',
    'Darkness Energy',
    '{D} Energy',
    'R Energy',
  ])('keeps special and other attachments as actual artwork: %s', (name) =>
    expect(basicAttachmentEnergyIndex(name)).toBeUndefined()
  );
  it.each([
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ])(
    'faces compact and expanded attachments like their seat at $width x $height',
    (viewport) => {
      const base = createRendererSpikeView();
      const view = {
        ...base,
        stacks: Object.fromEntries(
          Object.entries(base.stacks).map(([id, stack]) => [
            id,
            {
              ...stack,
              attachmentCards: Array.from({ length: 30 }, (_, index) => ({
                ...stack.attachmentCards[0]!,
                id: asViewCardId(`facing-${id}-${index}`),
              })),
            },
          ])
        ),
      };
      for (const bottomPlayerId of base.playerOrder)
        for (const farCardsUpright of [false, true]) {
          const scene = createBoardScene(
            view,
            createTableLayoutSnapshot({
              geometryVersion: 2,
              shellMode: 'fullscreen',
              viewport: { ...viewport, devicePixelRatio: 1 },
              playerIds: [base.playerOrder[0]!, base.playerOrder[1]!],
              bottomPlayerId,
              vertical: tableVerticalLayout(0.5),
              farCardsUpright,
            })
          );
          const attachments = scene.cards.filter(
            (card) => card.role === 'stackAttachment'
          );
          expect(attachments.length).toBeGreaterThan(0);
          for (const card of attachments) {
            const turns = card.side === 'opponent' && !farCardsUpright ? 2 : 0;
            expect(card.rotationQuarterTurns).toBe(turns);
            if (
              card.compactAttachment?.overflow ||
              card.id === attachments[0]!.id
            ) {
              const held = withHeldCards(scene, {
                ...DEFAULT_BOARD_PRESENTATION,
                drag: { cardId: card.id, x: 100, y: 200, targetId: null },
              }).cards.find((entry) => entry.id === card.id)!;
              expect(held.compactAttachment?.expanded).toBe(true);
              expect(held.rotationQuarterTurns).toBe(turns);
            }
          }
        }
    }
  );

  it('bounds large sets to two rows with an explicit overflow handle', () => {
    const host = { x: 10, y: 20, width: 120, height: 168 };
    const slots = compactAttachmentSlots(host, 30, false);
    expect(slots.at(-1)?.overflow).toBe(30 - slots.length + 1);
    expect(slots.length).toBeLessThan(30);
    for (const { bounds } of slots) {
      expect(bounds.x).toBeGreaterThanOrEqual(host.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(host.x + host.width);
    }
  });
  it.each([
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ])(
    'keeps the host large, every card accessible and held cards full-size at $width x $height',
    (viewport) => {
      const base = createRendererSpikeView();
      const player = base.playerOrder[0]!;
      const stack = base.stacks[base.boards[player]!.activeStackId!]!;
      const template = stack.attachmentCards[0]!;
      const build = (count: number) =>
        createBoardScene(
          {
            ...base,
            stacks: {
              ...base.stacks,
              [stack.id]: {
                ...stack,
                attachmentCards: Array.from({ length: count }, (_, index) => ({
                  ...template,
                  id: asViewCardId(`compact-${index}`),
                })),
              },
            },
          },
          createTableLayoutSnapshot({
            geometryVersion: 2,
            shellMode: 'fullscreen',
            viewport: { ...viewport, devicePixelRatio: 1 },
            playerIds: [base.playerOrder[0]!, base.playerOrder[1]!],
            bottomPlayerId: player,
            vertical: tableVerticalLayout(0.5),
          })
        );
      const empty = build(0),
        crowded = build(30);
      const topId = stack.evolutionCards.at(-1)!.id;
      expect(crowded.cards.find((card) => card.id === topId)?.bounds).toEqual(
        empty.cards.find((card) => card.id === topId)?.bounds
      );
      const attachments = crowded.cards.filter(
        (card) => card.parentId === stack.id && card.role === 'stackAttachment'
      );
      expect(attachments).toHaveLength(30);
      const first = attachments[0]!;
      const held = withHeldCards(crowded, {
        drag: {
          cardId: first.id,
          pointerId: 1,
          x: 100,
          y: 200,
          offsetX: 0,
          offsetY: 0,
          sourceId: stack.id,
          targetId: null,
        },
        settling: [],
        openedZoneId: null,
      });
      expect(
        held.cards.find((card) => card.id === first.id)?.bounds.height
      ).toBeGreaterThan(first.bounds.height * 2);
    }
  );
});
