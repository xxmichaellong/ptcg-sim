import { handElement, oppHandElement } from '../../front-end.js';
import { adjustAlignment } from '../../setup/sizing/adjust-alignment.js';

const handObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
            [handElement, oppHandElement].forEach(adjustAlignment);
        };
    });
});

// Options for the observer (which mutations to observe)
const handConfig = { childList: true };

// Start observing the target nodes for configured mutations
[handElement, oppHandElement].forEach(target => {
    handObserver.observe(target, handConfig);
});