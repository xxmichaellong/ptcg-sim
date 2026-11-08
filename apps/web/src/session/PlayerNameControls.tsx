import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';
import { isInputMethodKey } from '../ui/input-method.js';
export interface PlayerNameChoice {
  readonly id: string;
  readonly name: string;
  readonly editable: boolean;
  readonly onChange: (name: string) => void;
}
const NameField = ({
  player,
  seat,
}: {
  readonly player: PlayerNameChoice;
  readonly seat: string;
}) => {
  const { t } = useLingui();
  const [name, setName] = useState(player.name);
  const dirty = useRef(false);
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (pending.current === player.name) pending.current = null;
    if (!dirty.current) setName(player.name);
  }, [player.name, player.editable]);
  const save = () => {
    if (!player.editable || !dirty.current) return;
    dirty.current = false;
    const value = name.trim();
    setName(value || player.name);
    // A revert still needs to follow an earlier queued change, even if it
    // matches the currently published name.
    if (value && (value !== player.name || pending.current !== null)) {
      pending.current = value;
      player.onChange(value);
    }
  };
  return (
    <label className="ds-field">
      <span className="ds-label">{seat}</span>
      <input
        className="ds-input"
        aria-label={t`Name for ${seat}`}
        autoComplete="off"
        maxLength={64}
        value={player.editable ? name : player.name}
        disabled={!player.editable}
        onChange={(event) => {
          dirty.current = true;
          setName(event.target.value);
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (isInputMethodKey(event.nativeEvent)) return;
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            dirty.current = false;
            setName(player.name);
            event.stopPropagation();
          }
        }}
      />
    </label>
  );
};
export const PlayerNameControls = ({
  players,
}: {
  readonly players: readonly PlayerNameChoice[];
}) => (
  <fieldset className="ptcgsim-form-group">
    <legend className="ptcgsim-form-label">
      <Trans>Player names</Trans>
    </legend>
    {players.map((player, index) => (
      <NameField key={player.id} player={player} seat={`P${index + 1}`} />
    ))}
  </fieldset>
);
