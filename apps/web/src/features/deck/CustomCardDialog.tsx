import {
  customCardId,
  type CardCategory,
  type DeckCard,
} from '@ptcgsim/deck-core';
import { resolveCardPresentation } from '@ptcgsim/game-core';
import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';
import { useEffect, useRef, useState } from 'react';

import { trapFocus } from '../../ui/focus.js';

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
      setError('Card Name is required.');
      return;
    }
    if (normalizedName.length > CUSTOM_CARD_NAME_MAX) {
      setError(`Card Name must be ${CUSTOM_CARD_NAME_MAX} characters or less.`);
      return;
    }
    if (
      !Number.isSafeInteger(parsedQuantity) ||
      parsedQuantity < 1 ||
      parsedQuantity > CUSTOM_CARD_QUANTITY_MAX
    ) {
      setError(`Quantity must be between 1 and ${CUSTOM_CARD_QUANTITY_MAX}.`);
      return;
    }
    if (!normalizedImage) {
      setError('Image URL is required.');
      return;
    }
    if (normalizedImage.length > MAX_IMAGE_URL_CODE_UNITS) {
      setError(
        `Image URL must be ${MAX_IMAGE_URL_CODE_UNITS} characters or less.`
      );
      return;
    }
    if (imageState !== 'loaded') {
      setError('Image URL must point to a loadable image.');
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
      ? 'No image'
      : imageState === 'loading'
        ? 'Loading…'
        : imageState === 'failed'
          ? 'Image not found'
          : imageState === 'too_long'
            ? 'Image URL too long'
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
          Add Custom Card
        </div>
        <div className="native-deck-builder-modal-body">
          <div className="native-deck-builder-modal-fields">
            <label className="native-deck-builder-modal-label">
              Quantity
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
              Card Name
              <input
                ref={nameRef}
                id="nativeCustomCardName"
                className="native-deck-builder-modal-input ds-input"
                type="text"
                maxLength={CUSTOM_CARD_NAME_MAX}
                placeholder="e.g. Charizard"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="native-deck-builder-modal-label">
              Card Type
              <select
                id="nativeCustomCardType"
                className="native-deck-builder-modal-input ds-select"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as CardCategory)
                }
              >
                <option value="Pokémon">Pokémon</option>
                <option value="Trainer">Trainer</option>
                <option value="Energy">Energy</option>
              </select>
            </label>
            <label className="native-deck-builder-modal-label">
              Image URL
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
              <summary>Card layout (optional)</summary>
              <label className="native-deck-builder-modal-label">
                Layout
                <select
                  className="ds-select"
                  value={cardLayout}
                  onChange={(event) => {
                    setCardLayout(event.target.value);
                    setPiece('0');
                  }}
                >
                  <option value="auto">Recognize known card formats</option>
                  <option value="portrait">Ordinary portrait card</option>
                  <option value="landscape">
                    Sideways scan · rotate to read
                  </option>
                  <option value="break">Upper-half overlay · BREAK</option>
                  <option value="legend">Two landscape halves · LEGEND</option>
                  <option value="pair">
                    Two side-by-side pieces · Stadium
                  </option>
                  <option value="trio">Three side-by-side pieces</option>
                  <option value="union">Four-piece grid · V-UNION</option>
                </select>
              </label>
              {['legend', 'pair', 'trio', 'union'].includes(cardLayout) ? (
                <>
                  <label className="native-deck-builder-modal-label">
                    Artwork group
                    <input
                      className="ds-input"
                      maxLength={128}
                      placeholder="Same group for each piece"
                      value={artworkGroup}
                      onChange={(event) => setArtworkGroup(event.target.value)}
                    />
                  </label>
                  {/* Two to four places: all out at once (PX-044). */}
                  <div className="native-deck-builder-modal-label">
                    <span id="nativeCustomCardPieceLabel">Piece position</span>
                    <div
                      className="ptcgsim-segmented-control"
                      role="radiogroup"
                      aria-labelledby="nativeCustomCardPieceLabel"
                    >
                      {(cardLayout === 'union'
                        ? [
                            'Top left',
                            'Top right',
                            'Bottom left',
                            'Bottom right',
                          ]
                        : cardLayout === 'legend'
                          ? ['Top', 'Bottom']
                          : cardLayout === 'trio'
                            ? ['Left', 'Middle', 'Right']
                            : ['Left', 'Right']
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
                    Use the same group for pieces from one illustration. Place
                    Pokémon pieces in one stack, or Stadium pieces in the
                    Stadium area.
                  </p>
                </>
              ) : null}
            </details>
            <details className="native-custom-card-finish">
              <summary>Card finish (optional)</summary>
              <label className="native-deck-builder-modal-label">
                Finish
                <select
                  id="nativeCustomCardFinish"
                  className="ds-select"
                  value={finish}
                  onChange={(event) => setFinish(event.target.value)}
                >
                  <option value="auto">Automatic treatment</option>
                  <option value="matte">Matte</option>
                  <option value="sheen">Sleeve sheen</option>
                  <option value="holo">Holographic</option>
                  <option value="rainbow">Rainbow foil</option>
                </select>
              </label>
              <label className="native-deck-builder-modal-label">
                Foil coverage
                <select
                  id="nativeCustomCardFoilRegion"
                  className="ds-select"
                  value={foilRegion}
                  onChange={(event) => setFoilRegion(event.target.value)}
                >
                  <option value="auto">Match finish</option>
                  <option value="artwork">Artwork window</option>
                  <option value="full">Full card</option>
                  <option value="none">No foil</option>
                </select>
              </label>
              <p>
                Applies to this printing. Reading mode always removes
                reflections.
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
              alt="Card preview"
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
            Cancel
          </button>
          <button
            id="nativeCustomCardSubmit"
            type="button"
            className="ds-button ds-button--primary"
            onClick={submit}
          >
            Add to Deck
          </button>
        </div>
      </div>
    </div>
  );
};
