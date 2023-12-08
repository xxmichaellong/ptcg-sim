import { roomId } from "../front-end.js";
import { moveCard } from "../image-logic/move-card.js";
import { closeContainerPopups, deselectCard } from "../setup/close-popups.js";
import { oppActive, oppBench } from "../setup/opp-initialization.js";
import { active, bench, deck, sCard, target } from "../setup/self-initialization.js";
import { socket } from "../setup/socket.js";
import { addDamageCounter } from "./damage-counter.js";
import { draw, moveToDeckTop, shuffleIntoDeck, switchWithDeckTop } from "./deck-actions.js";
import { drawHand } from "./hand/draw-hand.js";
import { addSpecialCondition } from "./special-condition.js";

export const keyDraw = (event) => {
    if (!sCard.selecting){
        if (event.key >= 1 && event.key <= 9) {
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.classList.contains('circle')) {
                return;
            };
            const drawAmount = Math.min(event.key, deck.count);
            draw('self', drawAmount);
            socket.emit('draw', roomId, drawAmount);
        };
        if (event.key === 'n') {
            drawHand('self');
        };
        if (event.key >= 1 && event.key <= 9 && event.altKey) {
            //logic for viewing top of deck
        }
        if (event.key === 's') {
            //logic for shuffling deck
        };
        if (event.key === 'v') {
            //logic for viewing deck
        };
        if (event.key === 'f') {
            //logic for flipping coin
        };
        if (event.key === 'o') {
            //logic for flipping board
        };
        if (event.key === 'z' && event.ctrlKey) {
            //logic for undo
        };
        if (event.key === 't' && event.altKey) {
            //logic for starting turn
        };
        if (event.key === 'tab') {
            //logic ability counter
        };
    };
    
    if (sCard.selecting){
        const keyBinds = {
            'h': { locationAsString: 'hand', containerId: 'hand_html' },
            'd': { locationAsString: 'discard', containerId: 'discard_html' },
            'b': { locationAsString: 'bench', containerId: 'bench_html' },
            'a': { locationAsString: 'active', containerId: 'active_html' },
            'g': { locationAsString: 'stadium', containerId: 'stadium_html' },
            'l': { locationAsString: 'lostzone', containerId: 'lostzone_html' },
            'p': { locationAsString: 'prizes', containerId: 'prizes_html' },
            ' ': { locationAsString: 'board', containerId: 'board_html' },
            'ArrowDown': { locationAsString: 'deck', containerId: 'deck_html' },
    
            's': { locationAsString: 'deck', containerId: 'deck_html' },
            'ArrowUp': { locationAsString: 'deck', containerId: 'deck_html' },
            'ArrowRight': { locationAsString: 'deck', containerId: 'deck_html' },
        };
        const bind = keyBinds[event.key];
        if (bind) {
            target.locationAsString = bind.locationAsString;
            target.containerId = bind.containerId;
            target.index = '';
            deselectCard();

            if (event.key === 's'){
                shuffleIntoDeck();
            } else if (event.key === 'ArrowUp'){
                moveToDeckTop();
            } else if (event.key === 'ArrowRight'){
                switchWithDeckTop();
            } else {
                moveCard(sCard.user, sCard.locationAsString, sCard.containerId, target.locationAsString, target.containerId, sCard.index, target.index);
                socket.emit('moveCard', roomId, sCard.oUser, sCard.locationAsString, sCard.containerId, target.locationAsString, target.containerId, sCard.index, target.index);
            }
        };
        if (event.key === 'y' && sCard.containerId === 'active_html'){
            deselectCard();
            if (!sCard.card.image.specialCondition){
                addSpecialCondition(sCard.user, sCard.locationAsString, sCard.containerId, sCard.index);
            } else {
                if (event.altKey){
                    switch (sCard.card.image.specialCondition.textContent.toUpperCase()) {
                        case 'P':
                            sCard.card.image.specialCondition.textContent = 'A';
                            break;
                        case 'A':
                            sCard.card.image.specialCondition.textContent = 'Pa';
                            break;
                        case 'PA':
                            sCard.card.image.specialCondition.textContent = 'B';
                            break;
                        case 'B':
                            sCard.card.image.specialCondition.textContent = 'P';
                            break;
                    }
                    sCard.card.image.specialCondition.handleColour();
                } else {
                    sCard.card.image.specialCondition.textContent = '';
                    sCard.card.image.specialCondition.handleRemove();
                };
            };

        };
        if (event.key >= 1 && event.key <= 9 && ['active_html', 'bench_html'].includes(sCard.containerId)){
            deselectCard();
            if (!sCard.card.image.damageCounter){
                addDamageCounter(sCard.user, sCard.locationAsString, sCard.containerId, sCard.index);
                const damage = parseInt(event.key * 10);
                sCard.card.image.damageCounter.textContent = damage.toString();
            } else {
                let damage = parseInt(sCard.card.image.damageCounter.textContent);
                const amount = parseInt(event.key * 10);
                if (event.altKey) {
                    damage -= amount;
                } else {
                    damage += amount;
                }
                sCard.card.image.damageCounter.textContent = damage.toString();
                if (sCard.card.image.damageCounter.textContent <= 0){
                    sCard.card.image.damageCounter.handleRemove();
                };
            }
        };
        if (event.key === '0' && sCard.card.image.damageCounter){
            deselectCard();
            sCard.card.image.damageCounter.textContent = event.key;
            sCard.card.image.damageCounter.handleRemove();
        };
        if ((event.key === 'e' || event.key === 'q') && (!['active', 'bench'].includes(sCard.locationAsString) || sCard.card.image.attached)){
            closeContainerPopups();
            deselectCard();
            function highlightUnattachedCards(cards){
                cards.forEach(card => {
                    if (!card.image.attached){
                        card.image.classList.add('selectHighlight');
                    }
                });
            }
            if (sCard.user === 'self') {
                highlightUnattachedCards(active.cards);
                highlightUnattachedCards(bench.cards);
            } else {
                highlightUnattachedCards(oppActive.cards);
                highlightUnattachedCards(oppBench.cards);
            };
        };
    };
}

/*
'q': { locationAsString: 'attach', containerId: 'attach_html' },
'e': { locationAsString: 'evolve', containerId: 'evolve_html' }
*/