import { asViewCardId } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { finishForCard, inspectCard } from './card-inspection.js';

describe('card inspection', () => {
  it('gives rule-box Pokémon the rainbow foil, other Pokémon a holo, the rest a sheen', () => {
    for (const name of [
      'Charizard ex',
      'Lugia VSTAR',
      'Mew V',
      'Pikachu VMAX',
      'Tapu Lele-GX',
      'Mewtwo EX',
    ]) {
      expect(finishForCard({ name, category: 'Pokémon' }), name).toBe(
        'rainbow'
      );
    }
    expect(finishForCard({ name: 'Charmander', category: 'Pokémon' })).toBe(
      'holo'
    );
    expect(finishForCard({ name: 'Vivid Ex', category: 'Pokémon' })).toBe(
      'holo'
    );
    expect(finishForCard({ name: 'Ultra Ball', category: 'Trainer' })).toBe(
      'sheen'
    );
    expect(
      finishForCard({ name: 'Basic Fire Energy', category: 'Energy' })
    ).toBe('sheen');
  });

  it('shows the full-size face of a card the viewer can read and nothing else', () => {
    const view = createRendererSpikeView();
    const known = view.zones['zone:spike-blue:hand']!.cards[0]!;
    if (known.kind !== 'known') throw new Error('known card required');
    const inspection = inspectCard(view, String(known.id));
    expect(inspection).toMatchObject({
      cardId: String(known.id),
      name: view.definitions[known.definitionId]!.name,
      imageUrl: view.definitions[known.definitionId]!.imageUrl,
    });

    // The opponent's hand and the deck are concealed.
    const hidden = view.zones['zone:spike-red:hand']!.cards[0]!;
    expect(inspectCard(view, String(hidden.id))).toBeNull();
    // A known card lying face down is not shown either.
    const faceDown = {
      ...view,
      zones: {
        ...view.zones,
        'zone:spike-blue:hand': {
          ...view.zones['zone:spike-blue:hand']!,
          cards: [{ ...known, face: 'down' as const }],
        },
      },
    };
    expect(inspectCard(faceDown, String(known.id))).toBeNull();
    expect(inspectCard(view, String(asViewCardId('missing')))).toBeNull();
    expect(inspectCard(undefined, String(known.id))).toBeNull();
    // Cards in play stacks are found too.
    const stackCard = view.stacks['stack:blue:active']!.evolutionCards[0]!;
    expect(inspectCard(view, String(stackCard.id))?.cardId).toBe(
      String(stackCard.id)
    );
  });
});
