import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';
import { isInputMethodKey } from '../ui/input-method.js';
export interface PlayerNameChoice {
  readonly id: string;
  readonly name: string;
  readonly editable: boolean;
  readonly onChange: (name: string) => void | boolean | Promise<boolean>;
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
  const version = useRef(0);
  const mounted = useRef(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty.current) setName(player.name);
  }, [player.name, player.editable]);
  const save = () => {
    if (!player.editable || !dirty.current) return;
    dirty.current = false;
    const attempt = ++version.current;
    const value = name.trim();
    setName(value || player.name);
    setFailed(false);
    if (!value) return;
    const refused = () => {
      if (!mounted.current || version.current !== attempt) return;
      dirty.current = true;
      setFailed(true);
    };
    try {
      void Promise.resolve(player.onChange(value))
        .then((accepted) => {
          if (accepted === false) refused();
        })
        .catch(refused);
    } catch {
      refused();
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
        aria-invalid={player.editable && failed ? true : undefined}
        onChange={(event) => {
          dirty.current = true;
          version.current += 1;
          setFailed(false);
          setName(event.target.value);
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (isInputMethodKey(event.nativeEvent)) return;
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            dirty.current = false;
            version.current += 1;
            setFailed(false);
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
