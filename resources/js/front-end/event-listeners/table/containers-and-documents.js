import { oppContainersDocument, selfContainersDocument } from '../../front-end.js';
import { closePopups } from '../../actions/general/close-popups.js';
import { dragLeave, dragOver, drop } from '../../image-logic/drag.js';
import { keyDown, keyUp } from '../../key-toggles/key-shortcuts.js';

const addDocumentEventListeners = (document) => {
    document.addEventListener('click', (event) => closePopups(event));
    document.addEventListener('contextmenu', (event) => closePopups(event));
    document.addEventListener('keydown', (event) => keyDown(event));
    document.addEventListener('keyup', (event) => keyUp(event));
}

addDocumentEventListeners(document);
addDocumentEventListeners(selfContainersDocument);
addDocumentEventListeners(oppContainersDocument);

const addElementEventListeners = (container) => {
    container.addEventListener('dragover', dragOver);
    container.addEventListener('dragleave', dragLeave);
    container.addEventListener('drop', drop);
}

const zoneElementStrings = [
    'handElement',
    'prizesElement',
    'lostZoneCoverElement',
    'lostZoneElement',
    'activeElement',
    'benchElement',
    'deckCoverElement',
    'deckElement',
    'discardElement',
    'discardCoverElement',
    'stadiumElement',
    'boardElement',
    'viewCardsElement',
    'attachedCardsElement'
];

zoneElementStrings.forEach(id => {
    if (id === 'stadiumElement'){
        const element = document.getElementById(id);
        addElementEventListeners(element);
    } else {
        const selfContainer = selfContainersDocument.getElementById(id);
        addElementEventListeners(selfContainer);
        const oppContainer = oppContainersDocument.getElementById(id);
        addElementEventListeners(oppContainer);
    };
});