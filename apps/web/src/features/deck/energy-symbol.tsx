import type { EnergyType } from '@ptcgsim/deck-core';

import { ENERGY_LETTER } from './search-filters.js';

export const EnergySymbol = ({ type }: { readonly type: EnergyType }) => (
  <span className="energy-symbol" data-type={type} aria-hidden="true">
    {ENERGY_LETTER[type]}
  </span>
);
