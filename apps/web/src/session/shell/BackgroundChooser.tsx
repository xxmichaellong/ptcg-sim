import { Trans, useLingui } from '@lingui/react/macro';
import { LinkSimpleIcon } from '@phosphor-icons/react/dist/csr/LinkSimple';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';

import { TOUCH_ONLY_QUERY, useMediaQuery } from '../../ui/breakpoints.js';
import {
  ROOM_WALLPAPERS,
  type BackgroundChoice,
  type RoomBackground,
} from '../browser-room-background.js';
import {
  BACKGROUND_SOURCE_BYTES,
  encodeBackgroundImage,
  saveLocalBackground,
  useLocalBackgroundUrl,
  type BackgroundEncoder,
} from '../local-room-background.js';
import '../../board/view/table-art-controls.css';
import './background-chooser.css';

export type { BackgroundChoice };

type Tile = 'desk' | 'none' | 'wallpaper1' | 'wallpaper2' | 'custom';

const tileOf = (background: RoomBackground | undefined): Tile => {
  if (!background) return 'desk';
  if (background.kind === 'blank') return 'none';
  if (background.kind === 'local') return 'custom';
  return (
    ROOM_WALLPAPERS.find((wallpaper) => wallpaper.url === background.url)?.id ??
    'custom'
  );
};

const firstPicture = (files: FileList | null | undefined): File | undefined =>
  [...(files ?? [])].find((file) => file.type.startsWith('image/'));

const typing = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"]') !==
      null);

/**
 * The background chooser (Settings, Table): the desk, nothing, the two
 * wallpapers, and a picture of the player's own -- picked, dropped or
 * pasted, kept on this device (local-room-background.ts) -- or one from a
 * link. Each is a tile showing what it looks like.
 */
export const BackgroundChooser = ({
  choice,
  encode = encodeBackgroundImage,
  save = saveLocalBackground,
}: {
  readonly choice: BackgroundChoice;
  readonly encode?: BackgroundEncoder;
  readonly save?: (picture: Blob) => Promise<boolean>;
}) => {
  const { t } = useLingui();
  const touchOnly = useMediaQuery(TOUCH_ONLY_QUERY);
  const localUrl = useLocalBackgroundUrl();
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'failed' | 'large'>(
    'idle'
  );
  const [dragging, setDragging] = useState(false);
  const { current, onChange } = choice;
  const selected = tileOf(current);
  // The custom tile shows the player's own picture, or the link in use.
  const customUrl =
    current?.kind === 'image' && selected === 'custom' ? current.url : localUrl;
  const custom: RoomBackground | undefined =
    current?.kind === 'image' && selected === 'custom'
      ? current
      : localUrl
        ? { kind: 'local' }
        : undefined;

  const latest = useRef({ encode, save, onChange });
  latest.current = { encode, save, onChange };
  const takePicture = useCallback(async (picture: Blob): Promise<void> => {
    if (picture.size > BACKGROUND_SOURCE_BYTES) {
      setStatus('large');
      return;
    }
    setStatus('busy');
    const encoded = await latest.current.encode(picture);
    if (!encoded) {
      setStatus('failed');
      return;
    }
    // Kept on this device where it can be; for this visit otherwise.
    await latest.current.save(encoded);
    setStatus('idle');
    latest.current.onChange({ kind: 'local' });
  }, []);

  // A picture pasted while Settings is open, not into a field.
  useEffect(() => {
    const paste = (event: ClipboardEvent): void => {
      if (typing(event.target)) return;
      const picture = firstPicture(event.clipboardData?.files);
      if (!picture) return;
      event.preventDefault();
      void takePicture(picture);
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [takePicture]);

  const drop = (event: DragEvent<HTMLFieldSetElement>): void => {
    setDragging(false);
    const picture = firstPicture(event.dataTransfer.files);
    if (!picture) return;
    event.preventDefault();
    void takePicture(picture);
  };

  const tile = (
    id: Tile,
    label: string,
    preview: ReactNode,
    value: RoomBackground | undefined
  ) => (
    <span key={id} className="table-art-swatch background-tile">
      <input
        type="radio"
        id={`background-${id}`}
        name="roomBackground"
        value={id}
        checked={selected === id}
        onChange={() => onChange(value)}
      />
      <label htmlFor={`background-${id}`}>
        {preview}
        <span className="table-art-swatch__name">{label}</span>
      </label>
    </span>
  );
  const picture = (url: string) => (
    <span
      className="table-art-swatch__desk background-tile__picture"
      aria-hidden="true"
    >
      <img src={url} alt="" loading="lazy" decoding="async" />
    </span>
  );

  return (
    <fieldset
      className="ptcgsim-form-group background-chooser"
      data-dragging={dragging ? 'true' : undefined}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={drop}
    >
      <legend className="ptcgsim-form-label">
        <Trans>Background</Trans>
      </legend>
      <div className="table-art-swatches background-tiles">
        {tile(
          'desk',
          t({ message: 'Desk', context: 'the default background' }),
          <span
            className="table-art-swatch__desk background-tile__desk"
            aria-hidden="true"
          />,
          undefined
        )}
        {tile(
          'none',
          t({ message: 'None', context: 'no background' }),
          <span
            className="table-art-swatch__desk background-tile__plain"
            aria-hidden="true"
          />,
          { kind: 'blank' }
        )}
        {ROOM_WALLPAPERS.map((wallpaper, index) =>
          tile(
            wallpaper.id,
            t`Wallpaper ${index + 1}`,
            picture(wallpaper.url),
            { kind: 'image', url: wallpaper.url }
          )
        )}
        {custom && customUrl
          ? tile(
              'custom',
              t({ message: 'Custom', context: "the player's own background" }),
              picture(customUrl),
              custom
            )
          : null}
        <span className="table-art-swatch background-tile background-tile--add">
          <button
            id="backgroundFileButton"
            type="button"
            disabled={status === 'busy'}
            onClick={() => fileInput.current?.click()}
          >
            <span
              className="table-art-swatch__desk background-tile__add"
              aria-hidden="true"
            >
              <PlusIcon weight="bold" />
            </span>
            <span className="table-art-swatch__name">
              <Trans>Custom image…</Trans>
            </span>
          </button>
        </span>
      </div>
      <input
        ref={fileInput}
        id="backgroundFileInput"
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = firstPicture(event.currentTarget.files);
          event.currentTarget.value = '';
          if (file) void takePicture(file);
        }}
      />
      <div className="background-chooser__footer">
        <span className="ptcgsim-form-hint" role="status">
          {status === 'busy' ? (
            <Trans>Preparing picture…</Trans>
          ) : status === 'failed' ? (
            <Trans>Couldn't use that picture.</Trans>
          ) : status === 'large' ? (
            <Trans>Pictures up to 25 MB.</Trans>
          ) : touchOnly ? null : (
            <Trans>Or drop or paste a picture.</Trans>
          )}
        </span>
        <button
          id="changeBackgroundButton"
          type="button"
          className="ds-button ds-button--ghost"
          onClick={choice.onRequestLink}
        >
          <LinkSimpleIcon aria-hidden="true" weight="bold" />
          <Trans>From a link…</Trans>
        </button>
      </div>
    </fieldset>
  );
};
