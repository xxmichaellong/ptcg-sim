import { Trans, useLingui } from '@lingui/react/macro';
import {
  customCardId,
  type CardCategory,
  type DeckCard,
} from '@ptcgsim/deck-core';
import { resolveCardPresentation } from '@ptcgsim/game-core';
import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';
import { useEffect, useRef, useState } from 'react';

import { trapFocus } from '../../ui/focus.js';
import { categoryName } from './deck-labels.js';

const CUSTOM_CARD_QUANTITY_MAX = 99;
const CUSTOM_CARD_NAME_MAX = 256;

type CustomImageState = 'empty' | 'loading' | 'loaded' | 'failed' | 'too_long';

/**
 * A card that isn't in the catalog -- a proxy, a fan card, a scan -- made
 * from a name and an image address, with its layout on the table when it
 * isn't an ordinary portrait card.
 */
export const CustomCardDialog = ({
  open,
  onClose,
  onAdd,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onAdd: (card: DeckCard, quantity: number) => void;
}) => {
  const { t } = useLingui();
  const [quantity, setQuantity] = useState('1');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CardCategory>('Pokémon');
  const [imageUrl, setImageUrl] = useState('');
  const [cardLayout, setCardLayout] = useState('auto');
  const [finish, setFinish] = useState('auto');
  const [foilRegion, setFoilRegion] = useState('auto');
  const [artworkGroup, setArtworkGroup] = useState('');
  const [piece, setPiece] = useState('0');
  const [imageState, setImageState] = useState<CustomImageState>('empty');
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const normalizedImage = imageUrl.trim();

  useEffect(() => {
    if (!open) return;
    setQuantity('1');
    setName('');
    setCategory('Pokémon');
    setImageUrl('');
    setCardLayout('auto');
    setFinish('auto');
    setFoilRegion('auto');
    setArtworkGroup('');
    setPiece('0');
    setImageState('empty');
    setError('');
    nameRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!normalizedImage) setImageState('empty');
    else if (normalizedImage.length > MAX_IMAGE_URL_CODE_UNITS) {
      setImageState('too_long');
    } else setImageState('loading');
  }, [normalizedImage]);

  const submit = (): void => {
    const normalizedName = name.trim();
    const parsedQuantity = Number(quantity);
    if (!normalizedName) {
      setError(t`Card Name is required.`);
      return;
    }
    if (normalizedName.length > CUSTOM_CARD_NAME_MAX) {
      setError(
        t`Card Name must be ${{ max: CUSTOM_CARD_NAME_MAX }} characters or less.`
      );
      return;
    }
    if (
      !Number.isSafeInteger(parsedQuantity) ||
      parsedQuantity < 1 ||
      parsedQuantity > CUSTOM_CARD_QUANTITY_MAX
    ) {
      setError(
        t`Quantity must be between 1 and ${{ max: CUSTOM_CARD_QUANTITY_MAX }}.`
      );
      return;
    }
    if (!normalizedImage) {
      setError(t`Image URL is required.`);
      return;
    }
    if (normalizedImage.length > MAX_IMAGE_URL_CODE_UNITS) {
      setError(
        t`Image URL must be ${{ max: MAX_IMAGE_URL_CODE_UNITS }} characters or less.`
      );
      return;
    }
    if (imageState !== 'loaded') {
      setError(t`Image URL must point to a loadable image.`);
      return;
    }
    const grid =
      cardLayout === 'union'
        ? [2, 2]
        : cardLayout === 'legend'
          ? [1, 2]
          : cardLayout === 'pair'
            ? [2, 1]
            : cardLayout === 'trio'
              ? [3, 1]
              : undefined;
    const layoutPresentation =
      cardLayout === 'auto'
        ? resolveCardPresentation({
            name: normalizedName,
            imageUrl: normalizedImage,
          })
        : {
            readingQuarterTurns:
              cardLayout === 'break' ||
              cardLayout === 'legend' ||
              cardLayout === 'landscape'
                ? 1
                : 0,
            ...(cardLayout === 'break' ? { overlay: 'upper-half' } : {}),
            ...(grid
              ? {
                  join: {
                    key: artworkGroup.trim() || normalizedName.slice(0, 128),
                    columns: grid[0],
                    rows: grid[1],
                    part: Number(piece),
                  },
                }
              : {}),
          };
    const presentation =
      finish === 'auto' && foilRegion === 'auto'
        ? layoutPresentation
        : {
            readingQuarterTurns: 0,
            ...layoutPresentation,
            ...(finish === 'auto' ? {} : { finish }),
            ...(foilRegion === 'auto' ? {} : { foilRegion }),
          };
    onAdd(
      Object.freeze({
        id: customCardId([
          normalizedName,
          category,
          normalizedImage,
          presentation ?? null,
        ]),
        name: normalizedName,
        category,
        image: normalizedImage,
        ...(presentation ? { presentation } : {}),
      }),
      parsedQuantity
    );
    onClose();
  };

  const previewText =
    imageState === 'empty'
      ? t`No image`
      : imageState === 'loading'
        ? t`Loading…`
        : imageState === 'failed'
          ? t`Image not found`
          : imageState === 'too_long'
            ? t`Image URL too long`
            : '';

  return (
    <div
      id="nativeDeckBuilderCustomCardModal"
      className="native-deck-builder-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nativeCustomCardTitle"
      hidden={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        trapFocus(event, event.currentTarget);
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="native-deck-builder-modal-box">
        <div
          id="nativeCustomCardTitle"
          className="native-deck-builder-modal-title"
        >
          <Trans>Add Custom Card</Trans>
        </div>
        <div className="native-deck-builder-modal-body">
          <div className="native-deck-builder-modal-fields">
            <label className="native-deck-builder-modal-label">
              <Trans>Quantity</Trans>
              <input
                id="nativeCustomCardQty"
                className="native-deck-builder-modal-input ds-input"
                type="number"
                min="1"
                max={CUSTOM_CARD_QUANTITY_MAX}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <label className="native-deck-builder-modal-label">
              <Trans>Card Name</Trans>
              <input
                ref={nameRef}
                id="nativeCustomCardName"
                className="native-deck-builder-modal-input ds-input"
                type="text"
                maxLength={CUSTOM_CARD_NAME_MAX}
                placeholder={t`e.g. Charizard`}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="native-deck-builder-modal-label">
              <Trans>Card Type</Trans>
              <select
                id="nativeCustomCardType"
                className="native-deck-builder-modal-input ds-select"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as CardCategory)
                }
              >
                <option value="Pokémon">{categoryName('Pokémon')}</option>
                <option value="Trainer">{categoryName('Trainer')}</option>
                <option value="Energy">{categoryName('Energy')}</option>
              </select>
            </label>
            <label className="native-deck-builder-modal-label">
              <Trans>Image URL</Trans>
              <input
                id="nativeCustomCardImageUrl"
                className="native-deck-builder-modal-input ds-input"
                type="url"
                placeholder="https://..."
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
              />
            </label>
            <details className="native-custom-card-layout">
              <summary>
                <Trans>Card layout (optional)</Trans>
              </summary>
              <label className="native-deck-builder-modal-label">
                <Trans context="card layout">Layout</Trans>
                <select
                  className="ds-select"
                  value={cardLayout}
                  onChange={(event) => {
                    setCardLayout(event.target.value);
                    setPiece('0');
                  }}
                >
                  <option value="auto">{t`Recognize known card formats`}</option>
                  <option value="portrait">{t`Ordinary portrait card`}</option>
                  <option value="landscape">
                    {t`Sideways scan · rotate to read`}
                  </option>
                  <option value="break">{t`Upper-half overlay · BREAK`}</option>
                  <option value="legend">
                    {t`Two landscape halves · LEGEND`}
                  </option>
                  <option value="pair">
                    {t`Two side-by-side pieces · Stadium`}
                  </option>
                  <option value="trio">{t`Three side-by-side pieces`}</option>
                  <option value="union">{t`Four-piece grid · V-UNION`}</option>
                </select>
              </label>
              {['legend', 'pair', 'trio', 'union'].includes(cardLayout) ? (
                <>
                  <label className="native-deck-builder-modal-label">
                    <Trans>Artwork group</Trans>
                    <input
                      className="ds-input"
                      maxLength={128}
                      placeholder={t`Same group for each piece`}
                      value={artworkGroup}
                      onChange={(event) => setArtworkGroup(event.target.value)}
                    />
                  </label>
                  {/* Two to four places: all out at once (PX-044). */}
                  <div className="native-deck-builder-modal-label">
                    <span id="nativeCustomCardPieceLabel">
                      <Trans>Piece position</Trans>
                    </span>
                    <div
                      className="ptcgsim-segmented-control"
                      role="radiogroup"
                      aria-labelledby="nativeCustomCardPieceLabel"
                    >
                      {(cardLayout === 'union'
                        ? [
                            t`Top left`,
                            t`Top right`,
                            t`Bottom left`,
                            t`Bottom right`,
                          ]
                        : cardLayout === 'legend'
                          ? [
                              t({ message: 'Top', context: 'piece position' }),
                              t({
                                message: 'Bottom',
                                context: 'piece position',
                              }),
                            ]
                          : cardLayout === 'trio'
                            ? [
                                t({
                                  message: 'Left',
                                  context: 'piece position',
                                }),
                                t({
                                  message: 'Middle',
                                  context: 'piece position',
                                }),
                                t({
                                  message: 'Right',
                                  context: 'piece position',
                                }),
                              ]
                            : [
                                t({
                                  message: 'Left',
                                  context: 'piece position',
                                }),
                                t({
                                  message: 'Right',
                                  context: 'piece position',
                                }),
                              ]
                      ).map((label, index) => (
                        <span
                          key={label}
                          className="ptcgsim-segmented-control__option"
                        >
                          <input
                            type="radio"
                            id={`nativeCustomCardPiece-${index}`}
                            name="nativeCustomCardPiece"
                            value={index}
                            checked={piece === String(index)}
                            onChange={() => setPiece(String(index))}
                          />
                          <label htmlFor={`nativeCustomCardPiece-${index}`}>
                            {label}
                          </label>
                        </span>
                      ))}
                    </div>
                  </div>
                  <p>
                    <Trans>
                      Use the same group for pieces from one illustration. Place
                      Pokémon pieces in one stack, or Stadium pieces in the
                      Stadium area.
                    </Trans>
                  </p>
                </>
              ) : null}
            </details>
            <details className="native-custom-card-finish">
              <summary>
                <Trans>Card finish (optional)</Trans>
              </summary>
              <label className="native-deck-builder-modal-label">
                <Trans context="card surface">Finish</Trans>
                <select
                  id="nativeCustomCardFinish"
                  className="ds-select"
                  value={finish}
                  onChange={(event) => setFinish(event.target.value)}
                >
                  <option value="auto">{t`Automatic treatment`}</option>
                  <option value="matte">{t`Matte`}</option>
                  <option value="sheen">{t`Sleeve sheen`}</option>
                  <option value="holo">{t`Holographic`}</option>
                  <option value="rainbow">{t`Rainbow foil`}</option>
                </select>
              </label>
              <label className="native-deck-builder-modal-label">
                <Trans>Foil coverage</Trans>
                <select
                  id="nativeCustomCardFoilRegion"
                  className="ds-select"
                  value={foilRegion}
                  onChange={(event) => setFoilRegion(event.target.value)}
                >
                  <option value="auto">{t`Match finish`}</option>
                  <option value="artwork">{t`Artwork window`}</option>
                  <option value="full">{t`Full card`}</option>
                  <option value="none">{t`No foil`}</option>
                </select>
              </label>
              <p>
                <Trans>
                  Applies to this printing. Reading mode always removes
                  reflections.
                </Trans>
              </p>
            </details>
          </div>
          <div className="native-deck-builder-modal-preview">
            <img
              key={normalizedImage || 'empty'}
              id="nativeCustomCardPreviewImage"
              className="native-deck-builder-modal-preview-image"
              {...(normalizedImage.length <= MAX_IMAGE_URL_CODE_UNITS &&
              normalizedImage
                ? { src: normalizedImage }
                : {})}
              alt={t`Card preview`}
              style={{ display: imageState === 'loaded' ? '' : 'none' }}
              onLoad={() => setImageState('loaded')}
              onError={() => setImageState('failed')}
            />
            <div
              id="nativeCustomCardPreviewPlaceholder"
              className="native-deck-builder-modal-preview-placeholder"
              style={{ display: imageState === 'loaded' ? 'none' : '' }}
            >
              {previewText}
            </div>
          </div>
        </div>
        <div
          id="nativeCustomCardError"
          className="native-deck-builder-modal-error"
          aria-live="polite"
        >
          {error}
        </div>
        <div className="native-deck-builder-modal-actions">
          <button
            id="nativeCustomCardCancel"
            type="button"
            className="ds-button ds-button--secondary"
            onClick={onClose}
          >
            <Trans>Cancel</Trans>
          </button>
          <button
            id="nativeCustomCardSubmit"
            type="button"
            className="ds-button ds-button--primary"
            onClick={submit}
          >
            <Trans>Add to Deck</Trans>
          </button>
        </div>
      </div>
    </div>
  );
};
