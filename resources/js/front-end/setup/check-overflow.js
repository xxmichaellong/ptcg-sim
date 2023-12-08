import { oppHand_html } from "./opp-initialization.js";
import { hand_html } from "./self-initialization.js";

// Check if there's an overflow
function checkOverflow(element) {
    return element.scrollWidth > element.clientWidth;
}
// Change the justify-content property based on the overflow
export function adjustAlignment(element) {
    if (checkOverflow(element)) {
        element.style.justifyContent = 'flex-start';
    } else {
        element.style.justifyContent = 'center';
    }
}
// Create a new observer
const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
        if (mutation.type === 'childList') {
            // Call adjustAlignment for each target
            [hand_html, oppHand_html].forEach(adjustAlignment);
        }
    });
});

// Options for the observer (which mutations to observe)
const config = { childList: true };

// Start observing the target nodes for configured mutations
[hand_html, oppHand_html].forEach(target => {
    observer.observe(target, config);
});

// Call adjustAlignment for each target when the window is resized
window.addEventListener('resize', () => {
    [hand_html, oppHand_html].forEach(adjustAlignment);
});