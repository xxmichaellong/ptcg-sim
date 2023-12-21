import { reset } from '../../../actions/general/reset.js';
import { setup } from '../../../actions/general/setup.js';
import { POV, resetBothButton, resetButton, setupBothButton, setupButton } from '../../../front-end.js';

setupButton.addEventListener('click', () => setup(POV.user));

setupBothButton.addEventListener('click', () => {
    setup('self');
    setup('opp');
});

resetButton.addEventListener('click', () => reset(POV.user));

resetBothButton.addEventListener('click', () => {
    reset('self');
    reset('opp');
});