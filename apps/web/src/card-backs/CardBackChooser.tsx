import { useLingui } from '@lingui/react/macro';
import {
  CARD_BACK_COLOURS,
  CARD_BACK_EMBLEMS,
  CARD_BACK_PATTERNS,
  STANDARD_CARD_BACK,
  cardBackReference,
  isStandardCardBack,
  parseCardBack,
  type CardBackColour,
  type CardBackDesign,
  type CardBackEmblem,
  type CardBackPattern,
} from '@ptcgsim/game-core';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { UiButton } from '../ui/Button.js';
import '../ui/form-controls.css';
import {
  CARD_BACK_COLOUR_HEX,
  cardBackDesignImage,
} from './card-back-design.js';
import { cardBackImage } from './card-back-image.js';
import {
  CENTRED_CROP,
  CARD_BACK_IMAGE_HEIGHT,
  CARD_BACK_IMAGE_WIDTH,
  type CardBackCropFocus,
} from './card-back-import.js';
import { CARD_BACK_PRESETS } from './card-back-presets.js';
import { isTextEntry } from '../ui/text-entry.js';
import './card-back-chooser.css';

/**
 * The card-back chooser (ADR-041 stage 2): the back as it is now, a grid of
 * backs to pick from (the standard back first, the other presets, the
 * player's own designs and pictures), a sleeve designer, and a picture of
 * the player's own -- a file, a drop, a paste or a link -- placed in a
 * card's shape before it is saved. Nothing is typed but a link.
 */

/** The largest picture taken in; the store keeps a card-sized copy. */
export const CARD_BACK_PICTURE_BYTES = 20 * 1024 * 1024;

/** A sleeve designed from nothing in particular. */
const FIRST_DESIGN: CardBackDesign = Object.freeze({
  base: 'royal',
  pattern: 'plain',
  accent: 'snow',
  emblem: 'ball',
});

/** How far an arrow key moves a picture in its card. */
const NUDGE = 0.05;

export interface CardBackChooserProps {
  /** The back the seat wears now. */
  readonly current?: string;
  /** Backs the player's saved decks wear. */
  readonly worn: readonly string[];
  /** The player's latest designs and pictures, newest first. */
  readonly recent: readonly string[];
  readonly onChoose: (back: string) => void;
  readonly onCancel: () => void;
  /** An outside picture fetched through the app (never by the page). */
  readonly fetchPicture: (
    url: string,
    signal: AbortSignal
  ) => Promise<Blob | null>;
  /** A picture made a card back of our own: its `img:` reference, or null. */
  readonly savePicture: (
    picture: Blob,
    focus: CardBackCropFocus,
    signal: AbortSignal
  ) => Promise<string | null>;
}

type Mode = 'backs' | 'design' | 'picture';

interface Picture {
  readonly blob: Blob;
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'fetching' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'error'; readonly message: string };

const IDLE: Status = { kind: 'idle' };

/** A design or a picture of the player's own, not a preset or a URL. */
const ownMade = (back: string): boolean => {
  const kind = parseCardBack(back)?.kind;
  return kind === 'design' || kind === 'image';
};

/** How the chooser draws a back: as its owner sees it on the deck screen. */
const picture = (back: string): string =>
  cardBackImage(back, { own: true, opponentCustomBacks: true });

/** Held within 0 and 1, to a thousandth (the preview and the crop agree). */
const unit = (value: number): number =>
  Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;

/** The first link in some text, if it is one. */
const linkIn = (text: string): string | undefined => {
  const trimmed = text.trim();
  return /^https?:\/\/\S+$/iu.test(trimmed) ? trimmed : undefined;
};

/** A picture read enough to know its size, or null if it can't be read. */
const readPicture = async (blob: Blob): Promise<Picture | null> => {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth < 1 || image.naturalHeight < 1) {
      URL.revokeObjectURL(url);
      return null;
    }
    return {
      blob,
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
};

export const CardBackChooser = ({
  current,
  worn,
  recent,
  onChoose,
  onCancel,
  fetchPicture,
  savePicture,
}: CardBackChooserProps) => {
  const { t } = useLingui();
  const ids = useId();
  const presetBacks = useMemo(
    () => CARD_BACK_PRESETS.map((preset) => `preset:${preset.id}`),
    []
  );
  // The player's own, newest first, each once: what they made lately, then
  // what their saved decks wear.
  const yours = useMemo(
    () =>
      [
        ...new Set(
          [...recent, ...worn, ...(current ? [current] : [])].filter(ownMade)
        ),
      ].slice(0, 12),
    [current, recent, worn]
  );
  const currentDesign = useMemo(() => {
    const parsed = current ? parseCardBack(current) : null;
    return parsed?.kind === 'design' ? parsed.design : FIRST_DESIGN;
  }, [current]);
  const [mode, setMode] = useState<Mode>(
    current && parseCardBack(current)?.kind === 'design' ? 'design' : 'backs'
  );
  const [selected, setSelected] = useState<string>(() => {
    if (!current || isStandardCardBack(current)) return STANDARD_CARD_BACK;
    const parsed = parseCardBack(current);
    return parsed && parsed.kind !== 'url' ? current : STANDARD_CARD_BACK;
  });
  const [design, setDesign] = useState<CardBackDesign>(currentDesign);
  const [shown, setShown] = useState<Picture | null>(null);
  const [focus, setFocus] = useState<CardBackCropFocus>(CENTRED_CROP);
  const [status, setStatus] = useState<Status>(IDLE);
  const [link, setLink] = useState('');
  const work = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
    readonly from: CardBackCropFocus;
  } | null>(null);

  // A picture shown is let go when another replaces it or the chooser goes.
  useEffect(
    () => () => {
      if (shown) URL.revokeObjectURL(shown.url);
    },
    [shown]
  );
  useEffect(
    () => () => {
      work.current?.abort();
    },
    []
  );

  const busy =
    status.kind === 'fetching' ||
    status.kind === 'reading' ||
    status.kind === 'saving';
  const startWork = (): AbortSignal => {
    work.current?.abort();
    const controller = new AbortController();
    work.current = controller;
    return controller.signal;
  };

  // The picture taken last is the one shown and used: taking one lets go
  // of any still being read, fetched from a link or saved.
  const takePicture = async (
    blob: Blob,
    signal: AbortSignal = startWork()
  ): Promise<void> => {
    if (!blob.type.startsWith('image/')) {
      setStatus({ kind: 'error', message: t`That file isn't a picture.` });
      return;
    }
    if (blob.size > CARD_BACK_PICTURE_BYTES) {
      setStatus({
        kind: 'error',
        message: t`That picture is over 20 MB.`,
      });
      return;
    }
    setStatus({ kind: 'reading' });
    const read = await readPicture(blob);
    if (signal.aborted) {
      if (read) URL.revokeObjectURL(read.url);
      return;
    }
    if (!read) {
      setStatus({
        kind: 'error',
        message: t`That picture can't be read.`,
      });
      return;
    }
    setShown(read);
    setFocus(CENTRED_CROP);
    setMode('picture');
    setStatus(IDLE);
  };

  const getLink = async (url: string): Promise<void> => {
    const address = linkIn(url);
    if (!address) {
      setStatus({ kind: 'error', message: t`Paste a link to a picture.` });
      return;
    }
    const signal = startWork();
    setMode('picture');
    setStatus({ kind: 'fetching' });
    const blob = await fetchPicture(address, signal);
    if (signal.aborted) return;
    if (!blob) {
      setStatus({
        kind: 'error',
        message: t`Couldn't get a picture from that link.`,
      });
      return;
    }
    await takePicture(blob, signal);
  };

  const choice = (): string | undefined =>
    mode === 'backs'
      ? selected
      : mode === 'design'
        ? cardBackReference({ kind: 'design', design })
        : undefined;

  const accept = async (): Promise<void> => {
    if (busy) return;
    const back = choice();
    if (back) {
      onChoose(back);
      return;
    }
    if (!shown) return;
    const signal = startWork();
    setStatus({ kind: 'saving' });
    const saved = await savePicture(shown.blob, focus, signal);
    if (signal.aborted) return;
    if (!saved) {
      setStatus({
        kind: 'error',
        message: t`Couldn't save that picture. Try again.`,
      });
      return;
    }
    onChoose(saved);
  };

  // Enter on a back or a design choice uses it, as a form's would.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key !== 'Enter' ||
      !(event.target instanceof HTMLInputElement) ||
      event.target.type !== 'radio' ||
      event.target.closest('.card-back-chooser__modes')
    )
      return;
    event.preventDefault();
    void accept();
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    // A link typed into its own field stays there; a back or a mode with
    // the focus leaves the paste to the window.
    if (isTextEntry(event.target)) return;
    const file = [...event.clipboardData.files].find((each) =>
      each.type.startsWith('image/')
    );
    if (file) {
      event.preventDefault();
      void takePicture(file);
      return;
    }
    const pasted = linkIn(event.clipboardData.getData('text/plain'));
    if (pasted) {
      event.preventDefault();
      setLink(pasted);
      void getLink(pasted);
    }
  };

  const [dropping, setDropping] = useState(false);
  // A drop here is the chooser's, busy or not: the browser would open what
  // was dropped in place of the app. Busy, it is let go.
  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (busy) return;
    event.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDropping(false);
    if (busy) return;
    const file = [...event.dataTransfer.files][0];
    if (file) {
      void takePicture(file);
      return;
    }
    const dropped = linkIn(
      event.dataTransfer.getData('text/uri-list').split('\n')[0] ||
        event.dataTransfer.getData('text/plain')
    );
    if (dropped) {
      setLink(dropped);
      void getLink(dropped);
    }
  };

  // The picture's slack in a card's shape: where it can move, and which way.
  const targetRatio = CARD_BACK_IMAGE_WIDTH / CARD_BACK_IMAGE_HEIGHT;
  const pictureRatio = shown ? shown.width / shown.height : targetRatio;
  const movesSideways = pictureRatio > targetRatio + 0.01;
  const movesUpDown = pictureRatio < targetRatio - 0.01;
  const movable = movesSideways || movesUpDown;
  const place = (next: CardBackCropFocus): void =>
    setFocus({
      x: movesSideways ? unit(next.x) : 0.5,
      y: movesUpDown ? unit(next.y) : 0.5,
    });
  const onCropPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!movable || busy) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      from: focus,
    };
  };
  const onCropPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const held = drag.current;
    if (held?.pointerId !== event.pointerId) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (!shown || box.width <= 0 || box.height <= 0) return;
    // The picture follows the finger: what it overhangs the card by, on
    // screen, is the whole of its travel.
    const scale = Math.max(box.width / shown.width, box.height / shown.height);
    const spareX = shown.width * scale - box.width;
    const spareY = shown.height * scale - box.height;
    place({
      x: spareX > 1 ? held.from.x - (event.clientX - held.x) / spareX : 0.5,
      y: spareY > 1 ? held.from.y - (event.clientY - held.y) / spareY : 0.5,
    });
  };
  const endCropDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };
  const onCropKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = {
      ArrowLeft: { x: -NUDGE, y: 0 },
      ArrowRight: { x: NUDGE, y: 0 },
      ArrowUp: { x: 0, y: -NUDGE },
      ArrowDown: { x: 0, y: NUDGE },
    }[event.key];
    if (!step || !movable) return;
    event.preventDefault();
    place({ x: focus.x + step.x, y: focus.y + step.y });
  };

  const presetName = (id: string): string => {
    switch (id) {
      case 'standard':
        return t({ message: 'Standard', context: 'card back' });
      case 'crimson':
        return t({ message: 'Crimson', context: 'card back' });
      case 'azure':
        return t({ message: 'Azure', context: 'card back' });
      case 'jade':
        return t({ message: 'Jade', context: 'card back' });
      case 'amber':
        return t({ message: 'Amber', context: 'card back' });
      case 'violet':
        return t({ message: 'Violet', context: 'card back' });
      default:
        return id;
    }
  };
  const colourName = (colour: CardBackColour): string =>
    ({
      ink: t({ message: 'Ink', context: 'sleeve colour' }),
      slate: t({ message: 'Slate', context: 'sleeve colour' }),
      navy: t({ message: 'Navy', context: 'sleeve colour' }),
      royal: t({ message: 'Royal blue', context: 'sleeve colour' }),
      sky: t({ message: 'Sky', context: 'sleeve colour' }),
      teal: t({ message: 'Teal', context: 'sleeve colour' }),
      jade: t({ message: 'Jade', context: 'sleeve colour' }),
      lime: t({ message: 'Lime', context: 'sleeve colour' }),
      gold: t({ message: 'Gold', context: 'sleeve colour' }),
      amber: t({ message: 'Amber', context: 'sleeve colour' }),
      crimson: t({ message: 'Crimson', context: 'sleeve colour' }),
      rose: t({ message: 'Rose', context: 'sleeve colour' }),
      violet: t({ message: 'Violet', context: 'sleeve colour' }),
      plum: t({ message: 'Plum', context: 'sleeve colour' }),
      snow: t({ message: 'Snow', context: 'sleeve colour' }),
      sand: t({ message: 'Sand', context: 'sleeve colour' }),
    })[colour];
  const patternName = (pattern: CardBackPattern): string =>
    ({
      plain: t({ message: 'Plain', context: 'sleeve pattern' }),
      stripes: t({ message: 'Stripes', context: 'sleeve pattern' }),
      checks: t({ message: 'Checks', context: 'sleeve pattern' }),
      dots: t({ message: 'Dots', context: 'sleeve pattern' }),
      waves: t({ message: 'Waves', context: 'sleeve pattern' }),
      rays: t({ message: 'Rays', context: 'sleeve pattern' }),
      diamonds: t({ message: 'Diamonds', context: 'sleeve pattern' }),
      scales: t({ message: 'Scales', context: 'sleeve pattern' }),
    })[pattern];
  const emblemName = (emblem: CardBackEmblem): string =>
    ({
      none: t({ message: 'None', context: 'sleeve emblem' }),
      ball: t({ message: 'Ball', context: 'sleeve emblem' }),
      star: t({ message: 'Star', context: 'sleeve emblem' }),
      bolt: t({ message: 'Bolt', context: 'sleeve emblem' }),
      leaf: t({ message: 'Leaf', context: 'sleeve emblem' }),
      flame: t({ message: 'Flame', context: 'sleeve emblem' }),
      drop: t({ message: 'Drop', context: 'sleeve emblem' }),
      moon: t({ message: 'Moon', context: 'sleeve emblem' }),
    })[emblem];
  const yourName = (back: string): string =>
    parseCardBack(back)?.kind === 'design'
      ? t({ message: 'Design', context: 'a card back the player designed' })
      : t({ message: 'Picture', context: 'a card back from a picture' });

  const tile = (
    name: string,
    back: string,
    label: string,
    image: string,
    extra?: { readonly id?: string; readonly className?: string }
  ): ReactNode => (
    <label
      key={back}
      className={`card-back-tile${extra?.className ? ` ${extra.className}` : ''}`}
      data-card-back={back}
      onDoubleClick={() => onChoose(back)}
    >
      <input
        type="radio"
        name={name}
        value={back}
        {...(extra?.id ? { id: extra.id } : {})}
        checked={selected === back}
        onChange={() => setSelected(back)}
      />
      <img src={image} alt="" draggable={false} />
      <span className="card-back-tile__name">{label}</span>
    </label>
  );

  const designGroup = <Value extends string>(
    legend: string,
    key: keyof CardBackDesign,
    values: readonly Value[],
    label: (value: Value) => string,
    swatch: (value: Value) => ReactNode
  ): ReactNode => (
    <fieldset className="card-back-design__group">
      <legend className="ptcgsim-form-label">{legend}</legend>
      <div className="card-back-design__choices">
        {values.map((value) => (
          <label
            key={value}
            className="card-back-design__choice"
            title={label(value)}
          >
            <input
              type="radio"
              name={`${ids}-${key}`}
              value={value}
              checked={design[key] === value}
              aria-label={label(value)}
              onChange={() => setDesign({ ...design, [key]: value })}
            />
            {swatch(value)}
          </label>
        ))}
      </div>
    </fieldset>
  );

  const preview =
    mode === 'backs'
      ? picture(selected)
      : mode === 'design'
        ? cardBackDesignImage(design)
        : undefined;

  const modes: readonly { readonly value: Mode; readonly label: string }[] = [
    { value: 'backs', label: t({ message: 'Backs', context: 'card backs' }) },
    {
      value: 'design',
      label: t({ message: 'Design', context: 'design a card back' }),
    },
    {
      value: 'picture',
      label: t({ message: 'Picture', context: 'a card back from a picture' }),
    },
  ];

  return (
    <div
      className="card-back-chooser"
      data-dropping={dropping ? '' : undefined}
      data-mode={mode}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDragOver={onDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className="card-back-chooser__body">
        <div className="card-back-chooser__preview">
          {mode === 'picture' && shown ? (
            <div
              className="card-back-crop"
              data-movable={movable ? '' : undefined}
              role="img"
              aria-label={t`Your picture`}
              tabIndex={movable ? 0 : -1}
              onPointerDown={onCropPointerDown}
              onPointerMove={onCropPointerMove}
              onPointerUp={endCropDrag}
              onPointerCancel={endCropDrag}
              onKeyDown={onCropKeyDown}
            >
              <img
                src={shown.url}
                alt=""
                draggable={false}
                style={{
                  objectPosition: `${String(focus.x * 100)}% ${String(focus.y * 100)}%`,
                }}
              />
            </div>
          ) : preview ? (
            <img
              className="card-back-chooser__card"
              src={preview}
              alt=""
              draggable={false}
            />
          ) : (
            <div className="card-back-chooser__card card-back-chooser__card--empty" />
          )}
          {mode === 'picture' && shown && movable ? (
            <p className="card-back-chooser__hint">{t`Drag to place it`}</p>
          ) : null}
        </div>

        <div className="card-back-chooser__choices">
          <div
            className="ptcgsim-segmented-control card-back-chooser__modes"
            role="radiogroup"
            aria-label={t`How to choose`}
          >
            {modes.map((each) => (
              <span
                key={each.value}
                className="ptcgsim-segmented-control__option"
              >
                <input
                  type="radio"
                  id={`cardBackMode-${each.value}`}
                  name={`${ids}-mode`}
                  value={each.value}
                  checked={mode === each.value}
                  onChange={() => {
                    setMode(each.value);
                    // Another way of choosing lets go of a picture still
                    // on its way: it would take the chooser back.
                    if (busy && each.value !== 'picture') {
                      work.current?.abort();
                      setStatus(IDLE);
                    }
                    if (status.kind === 'error') setStatus(IDLE);
                  }}
                />
                <label htmlFor={`cardBackMode-${each.value}`}>
                  {each.label}
                </label>
              </span>
            ))}
          </div>

          {mode === 'backs' ? (
            <div
              className="card-back-grid"
              role="radiogroup"
              aria-label={t({ message: 'Backs', context: 'card backs' })}
            >
              {tile(
                `${ids}-back`,
                STANDARD_CARD_BACK,
                t`Standard back`,
                picture(STANDARD_CARD_BACK),
                {
                  id: 'standardCardBackChoice',
                  className: 'card-back-tile--standard',
                }
              )}
              {presetBacks
                .filter((back) => back !== STANDARD_CARD_BACK)
                .map((back) =>
                  tile(
                    `${ids}-back`,
                    back,
                    presetName(back.slice('preset:'.length)),
                    picture(back)
                  )
                )}
              {yours.length > 0 ? (
                <p className="card-back-grid__heading">
                  {t({
                    message: 'Yours',
                    context: 'card backs the player made',
                  })}
                </p>
              ) : null}
              {yours.map((back) =>
                tile(`${ids}-back`, back, yourName(back), picture(back))
              )}
            </div>
          ) : null}

          {mode === 'design' ? (
            <div className="card-back-design">
              {designGroup(
                t({ message: 'Colour', context: 'sleeve' }),
                'base',
                CARD_BACK_COLOURS,
                colourName,
                (colour) => (
                  <span
                    className="card-back-design__swatch"
                    style={{ background: CARD_BACK_COLOUR_HEX[colour] }}
                  />
                )
              )}
              {designGroup(
                t({ message: 'Pattern', context: 'sleeve' }),
                'pattern',
                CARD_BACK_PATTERNS,
                patternName,
                (pattern) => (
                  <img
                    className="card-back-design__sample"
                    src={cardBackDesignImage({
                      ...design,
                      pattern,
                      emblem: 'none',
                    })}
                    alt=""
                  />
                )
              )}
              {designGroup(
                t({ message: 'Accent', context: 'sleeve' }),
                'accent',
                CARD_BACK_COLOURS,
                colourName,
                (colour) => (
                  <span
                    className="card-back-design__swatch"
                    style={{ background: CARD_BACK_COLOUR_HEX[colour] }}
                  />
                )
              )}
              {designGroup(
                t({ message: 'Emblem', context: 'sleeve' }),
                'emblem',
                CARD_BACK_EMBLEMS,
                emblemName,
                (emblem) => (
                  <img
                    className="card-back-design__sample"
                    src={cardBackDesignImage({
                      ...design,
                      pattern: 'plain',
                      emblem,
                    })}
                    alt=""
                  />
                )
              )}
            </div>
          ) : null}

          {mode === 'picture' ? (
            <div className="card-back-picture">
              <div className="card-back-picture__drop">
                <UiButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {t`Choose a picture`}
                </UiButton>
                <span className="card-back-picture__or">
                  {t`or drop or paste one here`}
                </span>
                <input
                  ref={fileInput}
                  id="cardBackFileInput"
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void takePicture(file);
                  }}
                />
              </div>
              <form
                className="card-back-picture__link"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!busy) void getLink(link);
                }}
              >
                <label
                  className="ptcgsim-ui-field__label"
                  htmlFor="cardBackLinkInput"
                >
                  {t`From a link`}
                </label>
                <div className="card-back-picture__link-row">
                  <input
                    id="cardBackLinkInput"
                    className="ptcgsim-ui-field__input"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://"
                    value={link}
                    readOnly={busy}
                    onChange={(event) => setLink(event.currentTarget.value)}
                  />
                  <UiButton
                    type="submit"
                    variant="secondary"
                    disabled={busy || link.trim() === ''}
                    aria-busy={status.kind === 'fetching' ? true : undefined}
                  >
                    {status.kind === 'fetching' ? t`Getting…` : t`Get`}
                  </UiButton>
                </div>
              </form>
            </div>
          ) : null}

          <div className="card-back-chooser__status">
            {status.kind === 'error' ? (
              <p role="alert">{status.message}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="ptcgsim-ui-dialog__actions">
        <UiButton
          variant="secondary"
          data-dialog-action="cancel"
          onClick={() => {
            work.current?.abort();
            onCancel();
          }}
        >
          {t`Cancel`}
        </UiButton>
        <UiButton
          variant="primary"
          data-dialog-action="submit"
          id="useCardBackButton"
          disabled={busy || (mode === 'picture' && !shown)}
          aria-busy={status.kind === 'saving' ? true : undefined}
          onClick={() => void accept()}
        >
          {status.kind === 'saving' ? t`Saving…` : t`Use this back`}
        </UiButton>
      </div>
    </div>
  );
};
