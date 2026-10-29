import { Trans, useLingui } from '@lingui/react/macro';

import { preferences } from '../../preferences/preference-store.js';
import { usePreference } from '../../preferences/usePreference.js';
import { TABLE_ARTS } from '../../session/table-art.js';
import { TABLE_PREFERENCES } from '../../session/table-preferences.js';
import './table-art-controls.css';

/**
 * The table's artwork (Settings, Table): a swatch for each desk and
 * playmat, each a small table painted with that look's own tokens. A choice
 * repaints the table at once and stays on this device.
 */
export const TableArtControls = () => {
  const { i18n } = useLingui();
  const store = preferences();
  const { art } = usePreference(TABLE_PREFERENCES, store);
  return (
    <fieldset className="ptcgsim-form-group">
      <legend className="ptcgsim-form-label">
        <Trans context="the table's look">Style</Trans>
      </legend>
      <div className="table-art-swatches">
        {TABLE_ARTS.map((look) => (
          <span key={look.id} className="table-art-swatch">
            <input
              type="radio"
              id={`tableArt-${look.id}`}
              name="tableArt"
              value={look.id}
              checked={art === look.id}
              onChange={() => store.patch(TABLE_PREFERENCES, { art: look.id })}
            />
            <label htmlFor={`tableArt-${look.id}`}>
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
  );
};
