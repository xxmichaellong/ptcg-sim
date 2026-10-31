import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { ImageSquareIcon } from '@phosphor-icons/react/dist/csr/ImageSquare';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  customCardId,
  type CardCategory,
  type DeckCard,
} from '@ptcgsim/deck-core';
import {
  resolveCardPresentation,
  type CardPresentation,
} from '@ptcgsim/game-core';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';

import { trapFocus } from '../../ui/focus.js';
import { isInputMethodKey } from '../../ui/input-method.js';
import { uploadCardImage, type CardImageFailure } from './custom-card-image.js';
import { categoryName } from './deck-labels.js';
import { isTextEntry } from '../../ui/text-entry.js';

const CUSTOM_CARD_QUANTITY_MAX = 99;
const CUSTOM_CARD_NAME_MAX = 256;

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

/** A card in pieces: its grid, and whether it reads sideways. */
type MultiKind = 'union' | 'legend' | 'pair' | 'trio';
const PIECES: Readonly<
  Record<MultiKind, { columns: 1 | 2 | 3; rows: 1 | 2; turns: 0 | 1 }>
> = {
  union: { columns: 2, rows: 2, turns: 0 },
  legend: { columns: 1, rows: 2, turns: 1 },
  pair: { columns: 2, rows: 1, turns: 0 },
  trio: { columns: 3, rows: 1, turns: 0 },
};

/** One piece's picture, as far as it has got. */
type Slot =
  | { readonly status: 'empty' }
  | {
      readonly status: 'uploading';
      readonly preview: string;
      readonly link?: string;
    }
  | {
      readonly status: 'ready';
      readonly image: string;
      readonly link?: string;
      /** Wider than tall: a sideways scan. */
      readonly wide?: boolean;
    }
  | { readonly status: 'failed'; readonly failure: CardImageFailure };

const EMPTY: Slot = { status: 'empty' };

const pictureOf = (data: DataTransfer | null): File | undefined =>
  data
    ? [...data.files].find((file) => file.type.startsWith('image/'))
    : undefined;

const linkOf = (data: DataTransfer | null): string | undefined => {
  const listed = (data?.getData('text/uri-list') ?? '')
    .split(/\r?\n/u)
    .find((line) => line && !line.startsWith('#'));
  const text = (listed ?? data?.getData('text/plain') ?? '').trim();
  return /^https?:\/\/\S+$/iu.test(text) ? text : undefined;
};

/**
 * Where one piece's picture goes: a file chosen, dropped or pasted, or a
 * link, shown as it will be on the card.
 */
const ImageSlot = ({
  index,
  label,
  slot,
  onPicture,
}: {
  readonly index: number;
  /** A piece's place ("Top left"); none for a card in one piece. */
  readonly label?: string;
  readonly slot: Slot;
  readonly onPicture: (source: Blob | string | null) => void;
}) => {
  const { t } = useLingui();
  const slotLink =
    slot.status === 'ready' || slot.status === 'uploading'
      ? slot.link
      : undefined;
  const [link, setLink] = useState(slotLink ?? '');
  const [over, setOver] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const first = index === 0;
  const preview =
    slot.status === 'ready'
      ? slot.image
      : slot.status === 'uploading'
        ? slot.preview
        : undefined;
  // The field shows where the picture came from: its link, or nothing
  // for a file. A link that failed stays, to be put right.
  useEffect(() => {
    if (slot.status !== 'failed') setLink(slotLink ?? '');
  }, [slot.status, slotLink]);
  const commitLink = (value: string): void => {
    const next = value.trim();
    if (next && next !== slotLink) onPicture(next);
  };
  const failure =
    slot.status !== 'failed'
      ? ''
      : slot.failure === 'not_a_picture'
        ? t`Not a picture.`
        : slot.failure === 'too_long'
          ? t`Link too long.`
          : t`That picture didn't load.`;
  const onDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    setOver(false);
    const picture = pictureOf(event.dataTransfer);
    const dropped = picture ?? linkOf(event.dataTransfer);
    if (!dropped) return;
    if (typeof dropped === 'string') setLink(dropped);
    onPicture(dropped);
  };
  return (
    <div
      className="custom-card-slot"
      data-slot={index}
      data-status={slot.status}
      role="group"
      aria-label={label ?? t`Picture`}
    >
      <button
        type="button"
        className="custom-card-slot__frame"
        data-over={over ? 'true' : undefined}
        aria-label={
          preview
            ? t`Change the picture`
            : label
              ? t`Choose a picture: ${label}`
              : t`Choose a picture`
        }
        onClick={() => file.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {preview ? (
          <img
            {...(first ? { id: 'nativeCustomCardPreviewImage' } : {})}
            className="custom-card-slot__image"
            src={preview}
            alt={t`Card preview`}
          />
        ) : (
          <span
            {...(first ? { id: 'nativeCustomCardPreviewPlaceholder' } : {})}
            className="custom-card-slot__empty"
          >
            <ImageSquareIcon {...decorative} weight="duotone" />
            <span>{label ?? <Trans>Drop, paste or choose</Trans>}</span>
          </span>
        )}
        {slot.status === 'uploading' ? (
          <span className="custom-card-slot__busy">
            <CircleNotchIcon
              {...decorative}
              weight="bold"
              className="ds-spin"
            />
            <span className="ds-visually-hidden">
              <Trans>Uploading…</Trans>
            </span>
          </span>
        ) : null}
      </button>
      {preview ? (
        <button
          type="button"
          className="ds-icon-button custom-card-slot__clear"
          aria-label={t`Remove the picture`}
          onClick={() => onPicture(null)}
        >
          <XIcon {...decorative} weight="bold" />
        </button>
      ) : null}
      <input
        ref={file}
        id={`nativeCustomCardImageFile-${index}`}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = '';
          if (picked) onPicture(picked);
        }}
      />
      <input
        id={
          first
            ? 'nativeCustomCardImageUrl'
            : `nativeCustomCardImageUrl-${index}`
        }
        className="ds-input custom-card-slot__link"
        type="url"
        inputMode="url"
        aria-label={label ? t`Picture link: ${label}` : t`Picture link`}
        placeholder={t`or a link`}
        value={link}
        onChange={(event) => {
          setLink(event.target.value);
          // Pasted: the whole link is there at once.
          if (
            (event.nativeEvent as InputEvent).inputType === 'insertFromPaste'
          ) {
            commitLink(event.target.value);
          }
        }}
        onBlur={(event) => commitLink(event.target.value)}
        onKeyDown={(event) => {
          if (isInputMethodKey(event.nativeEvent)) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            commitLink(event.currentTarget.value);
          }
        }}
      />
      {failure ? (
        <p className="custom-card-slot__error" role="status">
          {failure}
        </p>
      ) : null}
    </div>
  );
};

/**
 * A card that isn't in the catalog -- a proxy, a fan card, a scan -- made
 * from a name and a picture; or a card in pieces (V-UNION, LEGEND, a split
 * Stadium) from one picture per piece, added together.
 */
export const CustomCardDialog = ({
  open,
  onClose,
  onAdd,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The card, or each piece of one, `quantity` times. */
  readonly onAdd: (cards: readonly DeckCard[], quantity: number) => void;
}) => {
  const { t } = useLingui();
  const [quantity, setQuantity] = useState('1');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CardCategory>('Pokémon');
  const [cardLayout, setCardLayout] = useState('auto');
  const [multi, setMulti] = useState<MultiKind | undefined>(undefined);
  const [finish, setFinish] = useState('auto');
  const [foilRegion, setFoilRegion] = useState('auto');
  const [slots, setSlots] = useState<readonly Slot[]>([EMPTY]);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  /** Each slot's upload under way, to drop when it is replaced. */
  const uploads = useRef(new Map<number, AbortController>());

  const pieces = multi ? PIECES[multi].columns * PIECES[multi].rows : 1;

  const cancelUploads = (): void => {
    for (const upload of uploads.current.values()) upload.abort();
    uploads.current.clear();
  };

  useEffect(() => {
    if (!open) return;
    setQuantity('1');
    setName('');
    setCategory('Pokémon');
    setCardLayout('auto');
    setMulti(undefined);
    setFinish('auto');
    setFoilRegion('auto');
    setSlots([EMPTY]);
    setError('');
    nameRef.current?.focus();
    return cancelUploads;
  }, [open]);

  const setSlot = (index: number, slot: Slot): void =>
    setSlots((current) =>
      current.map((value, at) => (at === index ? slot : value))
    );

  const setPicture = (index: number, source: Blob | string | null): void => {
    uploads.current.get(index)?.abort();
    uploads.current.delete(index);
    setError('');
    if (source === null) {
      setSlot(index, EMPTY);
      return;
    }
    const link = typeof source === 'string' ? source.trim() : undefined;
    const preview =
      typeof source === 'string' ? source.trim() : URL.createObjectURL(source);
    const controller = new AbortController();
    uploads.current.set(index, controller);
    setSlot(index, {
      status: 'uploading',
      preview,
      ...(link ? { link } : {}),
    });
    void uploadCardImage(source, controller.signal).then((result) => {
      if (!link) URL.revokeObjectURL(preview);
      if (controller.signal.aborted) return;
      uploads.current.delete(index);
      if ('failure' in result) {
        setSlot(index, { status: 'failed', failure: result.failure });
        return;
      }
      setSlot(index, {
        status: 'ready',
        image: result.url,
        ...(link ? { link } : {}),
        ...(result.wide ? { wide: true } : {}),
      });
    });
  };

  const chooseMulti = (kind: MultiKind | undefined): void => {
    const count = kind ? PIECES[kind].columns * PIECES[kind].rows : 1;
    setMulti(kind);
    setError('');
    // The pictures already given stay in their places.
    setSlots((current) =>
      Array.from({ length: count }, (_, index) => current[index] ?? EMPTY)
    );
    for (const [index, upload] of uploads.current) {
      if (index >= count) {
        upload.abort();
        uploads.current.delete(index);
      }
    }
  };

  const pieceLabels = (kind: MultiKind): readonly string[] =>
    kind === 'union'
      ? [t`Top left`, t`Top right`, t`Bottom left`, t`Bottom right`]
      : kind === 'legend'
        ? [
            t({ message: 'Top', context: 'piece position' }),
            t({ message: 'Bottom', context: 'piece position' }),
          ]
        : kind === 'trio'
          ? [
              t({ message: 'Left', context: 'piece position' }),
              t({ message: 'Middle', context: 'piece position' }),
              t({ message: 'Right', context: 'piece position' }),
            ]
          : [
              t({ message: 'Left', context: 'piece position' }),
              t({ message: 'Right', context: 'piece position' }),
            ];

  const submit = (): void => {
    const normalizedName = name.trim();
    const parsedQuantity = Number(quantity);
    if (!normalizedName) {
      setError(t`Enter a name.`);
      return;
    }
    if (normalizedName.length > CUSTOM_CARD_NAME_MAX) {
      setError(t`Name: up to ${{ max: CUSTOM_CARD_NAME_MAX }} characters.`);
      return;
    }
    if (
      !Number.isSafeInteger(parsedQuantity) ||
      parsedQuantity < 1 ||
      parsedQuantity > CUSTOM_CARD_QUANTITY_MAX
    ) {
      setError(t`Quantity: 1 to ${{ max: CUSTOM_CARD_QUANTITY_MAX }}.`);
      return;
    }
    if (slots.some((slot) => slot.status === 'uploading')) {
      setError(t`Still uploading…`);
      return;
    }
    const ready = slots.flatMap((slot) =>
      slot.status === 'ready' ? [slot] : []
    );
    if (ready.length < pieces) {
      setError(multi ? t`Add a picture for each piece.` : t`Add a picture.`);
      return;
    }
    const surface = {
      ...(finish === 'auto' ? {} : { finish }),
      ...(foilRegion === 'auto' ? {} : { foilRegion }),
    } as Partial<CardPresentation>;
    const finished = (
      presentation: CardPresentation | undefined
    ): CardPresentation | undefined =>
      Object.keys(surface).length === 0
        ? presentation
        : { readingQuarterTurns: 0, ...presentation, ...surface };
    const cardOf = (
      image: string,
      presentation: CardPresentation | undefined
    ): DeckCard =>
      Object.freeze({
        id: customCardId([
          normalizedName,
          category,
          image,
          presentation ?? null,
        ]),
        name: normalizedName,
        category,
        image,
        ...(presentation ? { presentation } : {}),
      });
    let cards: DeckCard[];
    if (multi) {
      const { columns, rows, turns } = PIECES[multi];
      // The pieces join by a key of their own: the name, and the first
      // picture's address (the same card made twice joins as one).
      const key = `${normalizedName.slice(0, 96)} ${ready[0]!.image.slice(-24)}`;
      cards = ready.map((slot, part) =>
        cardOf(
          slot.image,
          finished({
            readingQuarterTurns: turns,
            join: { key, columns, rows, part: part as 0 | 1 | 2 | 3 },
          })
        )
      );
    } else {
      const slot = ready[0]!;
      const presentation: CardPresentation | undefined =
        cardLayout === 'auto'
          ? (resolveCardPresentation({
              name: normalizedName,
              // A scan's own address says what it is (a V-UNION piece, a
              // LEGEND half) where our copy's can't.
              imageUrl: slot.link ?? slot.image,
            }) ?? (slot.wide ? { readingQuarterTurns: 1 } : undefined))
          : {
              readingQuarterTurns:
                cardLayout === 'break' || cardLayout === 'landscape' ? 1 : 0,
              ...(cardLayout === 'break' ? { overlay: 'upper-half' } : {}),
            };
      cards = [cardOf(slot.image, finished(presentation))];
    }
    onAdd(cards, parsedQuantity);
    onClose();
  };

  // A picture pasted anywhere in the window goes to the piece with the
  // focus, or the first without one.
  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const picture = pictureOf(event.clipboardData);
    const pasted =
      picture ??
      (isTextEntry(target) ? undefined : linkOf(event.clipboardData));
    if (!pasted) return;
    event.preventDefault();
    const focused = Number(
      target.closest('[data-slot]')?.getAttribute('data-slot') ?? NaN
    );
    const index = Number.isInteger(focused)
      ? focused
      : Math.max(
          0,
          slots.findIndex((slot) => slot.status !== 'ready')
        );
    setPicture(index, pasted);
  };

  const pieceGrid = multi ? PIECES[multi] : undefined;
  const labels = multi ? pieceLabels(multi) : [];

  return (
    <div
      id="nativeDeckBuilderCustomCardModal"
      className="native-deck-builder-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nativeCustomCardTitle"
      // A click on its blank parts keeps the focus in it, where its own
      // Esc closes it (not the deck screen behind).
      tabIndex={-1}
      hidden={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onPaste={onPaste}
      onKeyDown={(event) => {
        trapFocus(event, event.currentTarget);
        // An input method's Esc drops its candidate, not the window.
        if (event.key === 'Escape' && !isInputMethodKey(event.nativeEvent)) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="native-deck-builder-modal-box" data-multi={multi}>
        <div
          id="nativeCustomCardTitle"
          className="native-deck-builder-modal-title"
        >
          {multi ? <Trans>Multi-piece card</Trans> : <Trans>Custom card</Trans>}
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
              <Trans>Name</Trans>
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
              <Trans>Type</Trans>
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
            {multi ? (
              <label className="native-deck-builder-modal-label">
                <Trans>Pieces</Trans>
                <select
                  id="nativeCustomCardPieces"
                  className="native-deck-builder-modal-input ds-select"
                  value={multi}
                  onChange={(event) =>
                    chooseMulti(event.target.value as MultiKind)
                  }
                >
                  <option value="union">{t`V-UNION · 4 pieces`}</option>
                  <option value="legend">{t`LEGEND · 2 halves`}</option>
                  <option value="pair">{t`Stadium · 2 pieces`}</option>
                  <option value="trio">{t`3 pieces in a row`}</option>
                </select>
              </label>
            ) : (
              <details className="native-custom-card-layout">
                <summary>
                  <Trans>Layout (optional)</Trans>
                </summary>
                <label className="native-deck-builder-modal-label">
                  <Trans context="card layout">Layout</Trans>
                  <select
                    className="ds-select"
                    value={cardLayout}
                    onChange={(event) => setCardLayout(event.target.value)}
                  >
                    <option value="auto">{t`Automatic`}</option>
                    <option value="portrait">{t`Standard card`}</option>
                    <option value="landscape">{t`Sideways scan`}</option>
                    <option value="break">{t`BREAK`}</option>
                  </select>
                </label>
              </details>
            )}
            <details className="native-custom-card-finish">
              <summary>
                <Trans>Finish (optional)</Trans>
              </summary>
              <label className="native-deck-builder-modal-label">
                <Trans context="card surface">Finish</Trans>
                <select
                  id="nativeCustomCardFinish"
                  className="ds-select"
                  value={finish}
                  onChange={(event) => setFinish(event.target.value)}
                >
                  <option value="auto">{t`Automatic`}</option>
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
            </details>
            <button
              id="nativeCustomCardMultiPiece"
              type="button"
              className="ds-button ds-button--ghost native-custom-card-mode"
              onClick={() => chooseMulti(multi ? undefined : 'union')}
            >
              <SquaresFourIcon {...decorative} weight="bold" />
              {multi ? (
                <Trans>One card</Trans>
              ) : (
                <Trans>Add a multi-piece card</Trans>
              )}
            </button>
          </div>
          <div
            className="native-custom-card-slots"
            style={
              pieceGrid
                ? { gridTemplateColumns: `repeat(${pieceGrid.columns}, 1fr)` }
                : undefined
            }
          >
            {slots.map((slot, index) => (
              <ImageSlot
                key={index}
                index={index}
                {...(multi ? { label: labels[index] } : {})}
                slot={slot}
                onPicture={(source) => setPicture(index, source)}
              />
            ))}
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
            <Trans>Add to deck</Trans>
          </button>
        </div>
      </div>
    </div>
  );
};
