import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { compileGroup } from './compile-group.js';
import { BLUE, groupTable } from './group-table.test-support.js';
import { attachesAsEnergy, playsAsPokemon } from './plays-as.js';
import { predictWireCommand } from './predictWireCommand.js';
import {
  resolveAttachEvolveTarget,
  resolveAttachEvolveTargeting,
} from './resolveAttachEvolveTargeting.js';
import { resolveBoardDrop } from './resolveBoardDrop.js';
import { resolveLegacyBoardShortcutAction } from './resolveLegacyBoardShortcutAction.js';

const holon = {
  name: "Holon's Castform",
  category: 'Pokémon' as const,
  playsAs: 'Energy' as const,
};
const fossil = {
  name: 'Unidentified Fossil',
  category: 'Trainer' as const,
  playsAs: 'Pokémon' as const,
};
const energy = { name: 'Fire Energy', category: 'Energy' as const };

/** These cards of a seat's hand taken up into its Looking-at-cards window. */
const intoWindow = (
  view: MatchViewState,
  cardIds: readonly ViewCardId[]
): MatchViewState => {
  const hand = Object.values(view.zones).find(
    (zone) => zone.kind === 'hand' && zone.ownerId === BLUE
  )!;
  return {
    ...view,
    zones: {
      ...view.zones,
      [hand.id]: {
        ...hand,
        cards: hand.cards.filter((card) => !cardIds.includes(card.id)),
      },
    },
    workAreas: {
      ...view.workAreas,
      [BLUE]: {
        ...view.workAreas[BLUE]!,
        inspection: {
          id: `inspection:${BLUE}`,
          cards: hand.cards.filter((card) => cardIds.includes(card.id)),
          sourceZoneId: hand.id,
        },
      },
    },
  };
};

describe('a card played as another kind', () => {
  it('knows a Holon’s Pokémon and a Fossil by their print, and nothing else', () => {
    const table = groupTable();
    const [castform, plain] = table.put(BLUE, 'hand', holon, {}) as [
      ViewCardId,
      ViewCardId,
    ];
    const [doll] = table.put(BLUE, 'hand', fossil) as [ViewCardId];
    expect(attachesAsEnergy(table.view, castform)).toBe(true);
    expect(attachesAsEnergy(table.view, plain)).toBe(false);
    expect(playsAsPokemon(table.view, doll)).toBe(true);
    expect(playsAsPokemon(table.view, castform)).toBe(false);
  });

  it('offers no Energy attach for a Holon’s Pokémon that is a Pokémon in play', () => {
    const table = groupTable();
    // Played as a Pokémon, its top card: attaching can't start there.
    const benched = table.pokemon(BLUE, 'bench', [holon]);
    expect(attachesAsEnergy(table.view, benched.top)).toBe(false);
    // Under another, or attached, it can still go on as an Energy.
    const under = table.pokemon(BLUE, 'bench', [holon, {}]);
    expect(attachesAsEnergy(table.view, under.line[0]!)).toBe(true);
  });

  it('attaches a dropped Holon’s Pokémon as an Energy, and evolves with any other', () => {
    const table = groupTable();
    const active = table.pokemon(BLUE, 'active', [{}]);
    const [castform, plain] = table.put(BLUE, 'hand', holon, {}) as [
      ViewCardId,
      ViewCardId,
    ];
    const drop = (cardId: ViewCardId) =>
      resolveBoardDrop(table.view, table.scene(), {
        kind: 'CardDropRequested',
        cardId,
        targetId: active.stackId,
        x: 0,
        y: 0,
      });
    expect(drop(castform)).toEqual({
      ok: true,
      command: expect.objectContaining({
        type: 'MoveCardToPlay',
        targetStackId: active.stackId,
        asCategory: 'Energy',
      }),
    });
    const evolved = drop(plain);
    expect(evolved.ok && 'asCategory' in evolved.command).toBe(false);

    // Shown attached as an Energy at once.
    if (!evolved.ok) throw new Error('drop refused');
    const predicted = drop(castform);
    if (!predicted.ok) throw new Error('drop refused');
    const next = predictWireCommand(table.view, predicted.command)!;
    const attached = next.stacks[active.stackId]!.attachmentCards;
    expect(attached.map((card) => card.id)).toEqual([castform]);
    expect(attached[0]!.kind === 'known' && attached[0]!.category).toBe(
      'Energy'
    );
  });

  it('attaches one from a Looking-at-cards window as an Energy too', () => {
    const table = groupTable();
    const active = table.pokemon(BLUE, 'active', [{}]);
    const [castform] = table.put(BLUE, 'hand', holon) as [ViewCardId];
    const view = intoWindow(table.view, [castform]);
    const drop = resolveBoardDrop(view, table.scene(), {
      kind: 'CardDropRequested',
      cardId: castform,
      targetId: active.stackId,
      x: 0,
      y: 0,
    });
    expect(drop).toEqual({
      ok: true,
      command: expect.objectContaining({
        type: 'PlaceCardOnPlayStack',
        mode: 'attachment',
        asCategory: 'Energy',
      }),
    });
  });

  it('picks the Pokémon for "Attach as an Energy" on either board', () => {
    const table = groupTable();
    const active = table.pokemon(BLUE, 'active', [{}]);
    const [castform] = table.put(BLUE, 'hand', holon) as [ViewCardId];
    const plain = resolveAttachEvolveTargeting(table.view, castform);
    expect(plain.ok && plain.targeting.mode).toBe('evolution');
    const request = resolveLegacyBoardShortcutAction(table.view, {
      action: 'beginAttachOrEvolve',
      cardId: castform,
      asCategory: 'Energy',
    });
    expect(request).toMatchObject({
      ok: true,
      targeting: { mode: 'attachment', asCategory: 'Energy' },
    });
    if (!request.ok || !('targeting' in request)) throw new Error('refused');
    const placed = resolveAttachEvolveTarget(
      table.view,
      request.targeting!,
      active.top
    );
    expect(placed).toEqual({
      ok: true,
      command: expect.objectContaining({
        type: 'PlaceCardOnPlayStack',
        mode: 'attachment',
        asCategory: 'Energy',
      }),
    });
  });

  it('takes a Holon’s Pokémon in a group going onto a Pokémon, as an Energy', () => {
    const table = groupTable();
    const active = table.pokemon(BLUE, 'active', [{}]);
    const [castform, fire] = table.put(BLUE, 'hand', holon, energy) as [
      ViewCardId,
      ViewCardId,
    ];
    const compiled = compileGroup(table.context(), [castform, fire], {
      kind: 'drop',
      targetId: active.stackId,
    });
    expect(compiled.ok && compiled.command).toMatchObject({
      type: 'ApplyCardSteps',
      steps: [
        expect.objectContaining({ cardId: castform, asCategory: 'Energy' }),
        expect.objectContaining({ cardId: fire }),
      ],
    });
  });
});
