import { hand_html, oppHand_html } from '../../front-end.js';
import { adjustAlignment } from '../../setup/sizing/adjust-alignment.js';

const handObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
            // Call adjustAlignment for each target
            [hand_html, oppHand_html].forEach(adjustAlignment);
        }
    });
});

// Options for the observer (which mutations to observe)
const handConfig = { childList: true };

// Start observing the target nodes for configured mutations
[hand_html, oppHand_html].forEach(target => {
    handObserver.observe(target, handConfig);
});