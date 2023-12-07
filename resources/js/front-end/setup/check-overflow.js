import { oppContainersDocument } from "./opp-initialization.js";
import { selfContainersDocument } from "./self-initialization.js";

// Check if there's an overflow
function checkOverflow(element) {
    return element.scrollWidth > element.clientWidth;
}

// Change the justify-content property based on the overflow
function adjustAlignment() {
    if (checkOverflow(selfContainersDocument.getElementById('hand_html'))) {
        selfContainersDocument.getElementById('hand_html').style.justifyContent = 'flex-start';
    } else {
        selfContainersDocument.getElementById('hand_html').style.justifyContent = 'center';
    };

    if (checkOverflow(oppContainersDocument.getElementById('hand_html'))) {
        oppContainersDocument.getElementById('hand_html').style.justifyContent = 'flex-start';
    } else {
        oppContainersDocument.getElementById('hand_html').style.justifyContent = 'center';
    };
}

// Call the adjustAlignment function whenever the window is resized or an image is loaded
window.addEventListener('resize', adjustAlignment);
selfContainersDocument.getElementById('hand_html').addEventListener('load', adjustAlignment, true);
oppContainersDocument.getElementById('hand_html').addEventListener('load', adjustAlignment, true);

// Get the bench_html element
const bench = selfContainersDocument.getElementById('bench_html');

// Calculate the total width of all child divs
let totalWidth = 0;
for (let i = 0; i < bench.children.length; i++) {
    totalWidth += bench.children[i].offsetWidth;
}

// If the total width of the child divs is greater than the width of the bench,
// adjust the width of the bench
if (totalWidth > bench.offsetWidth) {
    bench.style.width = totalWidth + 'px';
}
