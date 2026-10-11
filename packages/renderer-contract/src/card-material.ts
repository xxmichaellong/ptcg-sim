/** A cosmetic treatment, not a claim about a card print's actual rarity. */
export type CardFinish = 'sheen' | 'holo' | 'rainbow';

const RULE_BOX = /(?:^|[\s-])(?:ex|EX|GX|V|VSTAR|VMAX|V-UNION|BREAK|LV\.X)$/u;

/** Only call with a definition already disclosed to this viewer. */
export const finishForCard = (definition: {
  readonly name: string;
  readonly category: string;
}): CardFinish => {
  if (definition.category !== 'Pokémon') return 'sheen';
  return RULE_BOX.test(definition.name.trim()) ? 'rainbow' : 'holo';
};
