import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';
import { STANDARD_COIN, STANDARD_CARD_BACK } from '@ptcgsim/game-core';
import { cardBackImage } from '../../card-backs/card-back-image.js';
import { coinImage } from '../../card-backs/coin-image.js';
import { preferences } from '../../preferences/preference-store.js';
import { usePreference } from '../../preferences/usePreference.js';
import { requestBrowserCardBack } from '../../session/browser-card-back.js';
import { editBrowserCoin } from '../../session/browser-coin.js';
import { TABLE_PREFERENCES } from '../../session/table-preferences.js';
import { TABLE_ARTS } from '../../session/table-art.js';
import { DECK_LOOK_THEMES, type DeckLook } from './deck-look-themes.js';
import type { SavedDeck, DeckLibraryActions } from './deck-library.js';
import '../../board/view/table-art-controls.css';
import './deck-customize.css';
const viewer = { own: true, opponentCustomBacks: true, ownDeckScreen: true };
export const DeckCustomize = ({
  deck,
  library,
}: {
  readonly deck: SavedDeck;
  readonly library: DeckLibraryActions;
}) => {
  const { t, i18n } = useLingui();
  const { themes } = usePreference(DECK_LOOK_THEMES);
  const { art } = usePreference(TABLE_PREFERENCES);
  const [name, setName] = useState('');
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  const patch = (look: DeckLook) => library.update(deck.id, look);
  const choose = async (kind: 'cardBack' | 'coin' | 'playmat') => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const value =
      kind === 'coin'
        ? await editBrowserCoin(
            deck.coin ?? STANDARD_COIN,
            controller.signal,
            false
          )
        : await requestBrowserCardBack({
            shape: kind === 'playmat' ? 'mat' : 'card',
            current:
              kind === 'cardBack'
                ? (deck.cardBack ?? STANDARD_CARD_BACK)
                : deck.playmat?.startsWith('style:')
                  ? STANDARD_CARD_BACK
                  : (deck.playmat ?? STANDARD_CARD_BACK),
            signal: controller.signal,
          });
    if (value && !controller.signal.aborted) patch({ [kind]: value });
  };
  const saveTheme = () => {
    const title = name.trim().slice(0, 80);
    if (!title) return;
    const before = preferences().get(DECK_LOOK_THEMES).themes;
    preferences().set(DECK_LOOK_THEMES, {
      themes: [
        ...before.filter((theme) => theme.name !== title),
        {
          id: crypto.randomUUID(),
          name: title,
          cardBack: deck.cardBack ?? STANDARD_CARD_BACK,
          coin: deck.coin ?? STANDARD_COIN,
          playmat: deck.playmat ?? 'style:default',
        },
      ].slice(-50),
    });
    setName('');
  };
  return (
    <section className="deck-customize" aria-label={t`Customize`}>
      <div className="deck-customize__looks">
        <button
          className="deck-customize__look"
          type="button"
          onClick={() => void choose('cardBack')}
        >
          <img
            src={cardBackImage(deck.cardBack ?? STANDARD_CARD_BACK, viewer)}
            alt=""
          />
          <span>
            <Trans>Card back</Trans>
          </span>
        </button>
        <button
          className="deck-customize__look"
          type="button"
          onClick={() => void choose('coin')}
        >
          <img
            className="deck-customize__coin"
            src={coinImage(deck.coin ?? STANDARD_COIN)}
            alt=""
          />
          <span>
            <Trans>Coin</Trans>
          </span>
        </button>
        <button
          className="deck-customize__look"
          type="button"
          onClick={() => void choose('playmat')}
        >
          <span
            className="deck-customize__mat"
            data-table-art-swatch={
              !deck.playmat || deck.playmat === 'style:default'
                ? art
                : deck.playmat.replace('style:', '')
            }
            style={
              deck.playmat && !deck.playmat.startsWith('style:')
                ? {
                    backgroundImage: `url("${cardBackImage(deck.playmat, { ...viewer, shape: 'mat' })}")`,
                  }
                : {}
            }
          />
          <span>
            <Trans>Playmat</Trans>
          </span>
        </button>
      </div>
      <fieldset>
        <legend>
          <Trans>Playmat</Trans>
        </legend>
        <div className="table-art-swatches">
          {TABLE_ARTS.map((look) => (
            <span className="table-art-swatch" key={look.id}>
              <input
                type="radio"
                name="deckPlaymat"
                id={`deckMat-${look.id}`}
                checked={
                  (deck.playmat && deck.playmat !== 'style:default'
                    ? deck.playmat
                    : `style:${art}`) === `style:${look.id}`
                }
                onChange={() => patch({ playmat: `style:${look.id}` })}
              />
              <label htmlFor={`deckMat-${look.id}`}>
                <span
                  className="table-art-swatch__desk"
                  data-table-art-swatch={look.id}
                  aria-hidden="true"
                >
                  <span className="table-art-swatch__mat" />
                </span>
                <span className="table-art-swatch__name">
                  {i18n._(look.name)}
                </span>
              </label>
            </span>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>
          <Trans>Themes</Trans>
        </legend>
        <div className="deck-customize__save">
          <input
            className="ds-input"
            aria-label={t`Theme name`}
            placeholder={t`Theme name`}
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                saveTheme();
              }
            }}
          />
          <button
            type="button"
            className="ds-button ds-button--secondary"
            disabled={!name.trim()}
            onClick={saveTheme}
          >
            <Trans>Save theme</Trans>
          </button>
        </div>
        <div className="deck-customize__themes">
          {themes.map((theme) => (
            <div key={theme.id}>
              <button
                type="button"
                className="ds-button ds-button--secondary"
                onClick={() =>
                  patch({
                    cardBack: theme.cardBack,
                    coin: theme.coin,
                    playmat: theme.playmat,
                  })
                }
              >
                {theme.name}
              </button>
              <button
                type="button"
                className="ds-button ds-button--ghost"
                aria-label={t`Delete ${theme.name}`}
                onClick={() =>
                  preferences().set(DECK_LOOK_THEMES, {
                    themes: preferences()
                      .get(DECK_LOOK_THEMES)
                      .themes.filter((each) => each.id !== theme.id),
                  })
                }
              >
                <Trans>Delete</Trans>
              </button>
            </div>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        className="ds-button ds-button--ghost deck-customize__reset"
        onClick={() =>
          patch({ cardBack: undefined, coin: undefined, playmat: undefined })
        }
      >
        <Trans>Reset</Trans>
      </button>
    </section>
  );
};
