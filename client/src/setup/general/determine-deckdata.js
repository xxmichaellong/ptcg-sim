import { systemState } from '../../front-end.js';

export const determineDeckData = (user) => {
  let deckData;
  if (user === 'self') {
    deckData = systemState.selfDeckData;
  } else {
    deckData = !systemState.isTwoPlayer
      ? systemState.p1OppDeckData
      : systemState.p2OppDeckData;
  }
  return deckData;
};
