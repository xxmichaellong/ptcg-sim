import { addDamageCounter } from "../general-actions/damage-counter.js";
import { addSpecialCondition } from "../general-actions/special-condition.js";
import { stringToVariable } from "./string-to-variable.js";
import { hand_html, stadium_html } from "./self-initialization.js";
import { oppHand_html } from "./opp-initialization.js";
import { adjustAlignment } from "./check-overflow.js";

const resizer = document.getElementById('resizer');
const selfContainers = document.getElementById('selfContainers');
const oppContainers = document.getElementById('oppContainers');

// Create the overlay div
const overlay = document.createElement('div');
overlay.style.position = 'fixed';
overlay.style.top = 0;
overlay.style.right = 0;
overlay.style.bottom = 0;
overlay.style.left = 0;
overlay.style.zIndex = 1000; // Adjust as needed

resizer.addEventListener('mousedown', function(e) {
    e.preventDefault();
    window.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', stopResize);

    // Add the overlay to the body
    document.body.appendChild(overlay);
});

function stopResize(e) {
    window.removeEventListener('mousemove', resize);
    document.removeEventListener('mouseup', stopResize);

    // Remove the overlay from the body
    document.body.removeChild(overlay);
}

function resize(e) {
    //adjust hand container
    [hand_html, oppHand_html].forEach(adjustAlignment);

    const oldSelfHeight = parseInt(selfContainers.offsetHeight);
    const oldOppHeight = parseInt(oppContainers.offsetHeight);

    const clientY = Math.max(1, Math.min(e.clientY, window.innerHeight - 1));    // Calculate the new heights
    const newSelfHeight = ((window.innerHeight - clientY) / window.innerHeight) * 100;
    const newOppHeight = 100 - newSelfHeight;

    // Apply the new heights
    selfContainers.style.height = newSelfHeight + '%';
    oppContainers.style.height = newOppHeight + '%';

    // Apply the new bottom position
    stadium_html.style.bottom = (Math.min(84, (100 - 8 - (clientY / window.innerHeight) * 100))) + '%';
    resizer.style.bottom = (100 - 3 - (clientY / window.innerHeight) * 100) + '%';
    oppContainers.style.bottom = (100 - (clientY / window.innerHeight) * 100) + '%';

    const _newSelfHeight = parseInt(selfContainers.offsetHeight);
    const selfRatio = _newSelfHeight/oldSelfHeight;
    const _newOppHeight = parseInt(oppContainers.offsetHeight);
    const oppRatio = _newOppHeight/oldOppHeight;
    // Readjust the width of containers on the active/bench
    function adjustCards(user, location, container, ratio){

        const _location = location;
        const _container = container;
        location = stringToVariable(user, location);
        container = stringToVariable(user, container);

        location.cards.forEach(card => {
            if (card.image.attached){
                if (card.type === 'pokemon'){
                    const oldBottom = parseFloat(card.image.style.bottom);
                    const newBottom = oldBottom * ratio;
                    card.image.style.bottom = `${newBottom}px`;
                } else {
                    const oldLeft = parseFloat(card.image.style.left);
                    const newLeft = oldLeft * ratio;
                    card.image.style.left = `${newLeft}px`;
                };
            } else {
                const baseWidth = parseFloat(card.image.clientWidth);
                const adjustment = parseFloat(card.image.clientWidth/6); //hard coded
                const newWidth = (baseWidth + card.image.energyLayer * adjustment) * selfRatio;
                card.image.parentElement.style.width = `${newWidth}px`;
            };
            if (card.image.damageCounter){
                const index = location.cards.findIndex(_card => _card === card);
                addDamageCounter(user, _location, _container, index);
            };
            if (card.image.specialCondition){
                const index = location.cards.findIndex(_card => _card === card);
                addSpecialCondition(user, _location, _container, index);
            };
        });
    }

    adjustCards('self', 'bench', 'bench_html', selfRatio);
    adjustCards('self', 'active', 'active_html', selfRatio);
    adjustCards('opp', 'bench', 'bench_html', oppRatio);
    adjustCards('opp', 'active', 'active_html', oppRatio);
}

