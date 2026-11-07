import { t } from '@lingui/core/macro';

/**
 * The "Ability used" marker's two actions, as menus, the palette and the
 * marker's own controls name them: a Pokémon's in play by its Ability, the
 * owner's wording; a loose card's (a Stadium, a card in the discard) as a
 * plain mark, since it has no Ability.
 */
export const abilityMarkerLabel = (
  outcome: 'markUsed' | 'markUnused',
  onPokemon: boolean
): string => {
  if (onPokemon) {
    return outcome === 'markUsed'
      ? t({
          message: 'Use Ability',
          comment:
            'Puts the "Ability used" marker on a Pokémon: its Ability was used this turn. Short, for a menu.',
        })
      : t({
          message: 'Unuse Ability',
          comment:
            'Takes the "Ability used" marker off a Pokémon, so its Ability reads as not used this turn. Short, for a menu.',
        });
  }
  return outcome === 'markUsed'
    ? t({
        message: 'Mark as used',
        comment:
          'Puts the "used" marker on a card that is not a Pokémon in play (a Stadium, a card in the discard): its effect was used this turn.',
      })
    : t({
        message: 'Mark as unused',
        comment:
          'Takes the "used" marker off a card that is not a Pokémon in play.',
      });
};
