import { reset } from '../../../actions/general/reset.js';
import { setup } from '../../../actions/general/setup.js';
import { POV, p2ResetButton, p2SetupButton } from '../../../front-end.js';

p2SetupButton.addEventListener('click', () => setup(POV.user));

p2ResetButton.addEventListener('click', () => reset(POV.user));