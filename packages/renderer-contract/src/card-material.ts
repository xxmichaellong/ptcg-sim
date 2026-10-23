/** A cosmetic treatment, not a claim about a card print's actual rarity. */
export type CardFinish = 'matte' | 'sheen' | 'holo' | 'rainbow';

const RULE_BOX = /(?:^|[\s-])(?:ex|EX|GX|V|VSTAR|VMAX|V-UNION|BREAK|LV\.X)$/u;

/** Only call with a definition already disclosed to this viewer. */
export const finishForCard = (definition: {
  readonly name: string;
  readonly category: string;
  readonly presentation?: { readonly finish?: CardFinish };
}): CardFinish => {
  if (definition.presentation?.finish) return definition.presentation.finish;
  if (definition.category !== 'Pokémon') return 'sheen';
  return RULE_BOX.test(definition.name.trim()) ? 'rainbow' : 'holo';
};
