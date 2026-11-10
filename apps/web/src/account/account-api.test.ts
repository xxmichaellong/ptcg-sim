import { describe, expect, it } from 'vitest';

import { readAccountBody, signInStartUrl } from './account-api.js';

describe('the account routes, as the app calls them', () => {
  it('reads an account and drops what it does not know', () => {
    expect(
      readAccountBody({
        id: 'a_ABCDEFGHIJKLMNOP',
        name: 'Dawn',
        avatar: 'initials',
        createdAt: 1,
        sessionProvider: 'google',
        methods: [
          { provider: 'google', label: 'dawn@gmail.example', linkedAt: 1 },
          { provider: 'myspace', label: 'x', linkedAt: 1 },
        ],
      })
    ).toEqual({
      id: 'a_ABCDEFGHIJKLMNOP',
      name: 'Dawn',
      avatar: 'initials',
      createdAt: 1,
      sessionProvider: 'google',
      methods: [
        { provider: 'google', label: 'dawn@gmail.example', linkedAt: 1 },
      ],
    });
    expect(readAccountBody({ id: 'a', name: 'Dawn' })).toBeUndefined();
    expect(readAccountBody(null)).toBeUndefined();
  });

  it('starts a sign-in with where to come back to', () => {
    const url = new URL(
      signInStartUrl('discord', 'link', 'popup', '/?room=ABCD'),
      'https://beta.example'
    );
    expect(url.pathname).toBe('/v2/auth/discord/start');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      intent: 'link',
      display: 'popup',
      return: '/?room=ABCD',
    });
  });
});
