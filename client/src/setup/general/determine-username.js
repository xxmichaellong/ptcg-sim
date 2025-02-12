import { systemState } from '../../front-end.js';

export const determineUsername = (user) => {
  let username;
  if (!systemState.isTwoPlayer) {
    username = systemState.p1Username(user);
  } else {
    username =
      user === 'self' ? systemState.p2SelfUsername : systemState.p2OppUsername;
  }
  return username;
};
