import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
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
  useEffect(() => setName(player.name), [player.name]);
  const save = () => {
    const value = name.trim();
    if (value && value !== player.name) player.onChange(value);
    else setName(player.name);
  };
  return (
    <label className="ds-field">
      <span className="ds-label">{seat}</span>
      <input
        className="ds-input"
        aria-label={t`Name for ${seat}`}
        autoComplete="off"
        maxLength={64}
        value={name}
        disabled={!player.editable}
        onChange={(event) => setName(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
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
