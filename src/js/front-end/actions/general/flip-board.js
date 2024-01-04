import { FREEBUTTON, systemState, attackButton, boardElement, oppBoardElement, oppContainers, oppContainersDocument, oppResizer, oppViewCardsElement, p2AttackButton, p2FREEBUTTON, p2PassButton, p2ResetButton, p2SetupButton, passButton, resetButton, selfContainers, selfContainersDocument, selfResizer, setupButton, stadiumArray, stadiumElement, viewCardsElement } from '../../front-end.js';
import { flippedOppHandleMouseDown, flippedSelfHandleMouseDown, oppHandleMouseDown, selfHandleMouseDown } from '../../setup/sizing/resizer.js';
import { reloadBoard } from '../../setup/sizing/reload-board.js';

export const flipBoard = () => {    
    if (selfContainers.classList.contains('self')){
        selfResizer.removeEventListener('mousedown', selfHandleMouseDown);
        oppResizer.removeEventListener('mousedown', oppHandleMouseDown);
        selfResizer.addEventListener('mousedown', flippedSelfHandleMouseDown);
        oppResizer.addEventListener('mousedown', flippedOppHandleMouseDown);
    } else {
        selfResizer.addEventListener('mousedown', selfHandleMouseDown);
        oppResizer.addEventListener('mousedown', oppHandleMouseDown);
        selfResizer.removeEventListener('mousedown', flippedSelfHandleMouseDown);
        oppResizer.removeEventListener('mousedown', flippedOppHandleMouseDown);
    };

    viewCardsElement.classList.toggle('flip-image');
    oppViewCardsElement.classList.toggle('flip-image');
    
    const toggleClasses = (element, class1, class2) => {
        element.classList.toggle(class1);
        element.classList.toggle(class2);
    };

    toggleClasses(selfResizer, 'self-color', 'opp-color');
    toggleClasses(oppResizer, 'opp-color', 'self-color');
    toggleClasses(selfContainers, 'self', 'opp');
    toggleClasses(oppContainers, 'opp', 'self');
    toggleClasses(boardElement, 'selfBoard', 'oppBoard');
    toggleClasses(oppBoardElement, 'oppBoard', 'selfBoard');
    toggleClasses(attackButton, 'self-color', 'opp-color');
    toggleClasses(passButton, 'self-color', 'opp-color');
    toggleClasses(FREEBUTTON, 'self-color', 'opp-color');
    toggleClasses(setupButton, 'self-color', 'opp-color');
    toggleClasses(resetButton, 'self-color', 'opp-color');
    toggleClasses(p2AttackButton, 'self-color', 'opp-color');
    toggleClasses(p2PassButton, 'self-color', 'opp-color');
    toggleClasses(p2FREEBUTTON, 'self-color', 'opp-color');
    toggleClasses(p2SetupButton, 'self-color', 'opp-color');
    toggleClasses(p2ResetButton, 'self-color', 'opp-color');

    const users = ['self', 'opp'];
    const textIds = ['deckText', 'discardText', 'lostZoneText', 'handText'];
    const zoneElementStrings = ['deckElement', 'discardElement', 'lostZoneElement', 'attachedCardsElement', 'viewCardsElement'];
    const buttonIds = ['viewCardsButtonContainer', 'attachedCardsPopupButtonContainer'];
    const headerIds = ['attachedCardsPopupHeader', 'viewCardsHeader'];
    const buttonzoneElementStrings = ['buttonContainer'];

    for (const user of users) {
        const document = user === 'self' ? selfContainersDocument : oppContainersDocument;
    
        for (const textId of textIds) {
            const text = document.getElementById(textId);
            text.classList.toggle('self-text');
            text.classList.toggle('opp-text');
        };
        for (const zoneElementString of zoneElementStrings) {
            const element = document.getElementById(zoneElementString);
            element.classList.toggle('self-view');
            element.classList.toggle('opp-view');
        };
        for (const buttonId of buttonIds) {
            const button = document.getElementById(buttonId);
            button.classList.toggle('self-button-container');
            button.classList.toggle('opp-button-container');
        };
        for (const headerId of headerIds) {
            const header = document.getElementById(headerId);
            header.classList.toggle('self-header');
            header.classList.toggle('opp-header');
            if (header.textContent === 'Move attached cards'){
                header.textContent = 'Opponent moving cards...' 
            } else if (header.textContent === 'Opponent moving cards...'){
                header.textContent = 'Move attached cards';
            };
        };
        for (const buttonzoneElementString of buttonzoneElementStrings) {
            const button = document.getElementById(buttonzoneElementString);
            button.classList.toggle('selfButtonContainer');
            button.classList.toggle('oppButtonContainer');
        };
    };

    const selfCircleElements = selfContainersDocument.querySelectorAll('.self-circle, .opp-circle');
    const oppCircleElements = oppContainersDocument.querySelectorAll('.self-circle, .opp-circle');

    selfCircleElements.forEach(element => {
        element.classList.toggle('self-circle');
        element.classList.toggle('opp-circle');
    });
    oppCircleElements.forEach(element => {
        element.classList.toggle('self-circle');
        element.classList.toggle('opp-circle');
    });
    
    // Swap heights
    let tempHeight = selfContainers.style.height;
    selfContainers.style.height = oppContainers.style.height;
    oppContainers.style.height = tempHeight;

    // Swap bottom lengths
    let tempBottom = selfContainers.style.bottom;
    selfContainers.style.bottom = oppContainers.style.bottom;
    oppContainers.style.bottom = tempBottom;
    
    // Flip the stadium
    if (stadiumArray[0]){
        if (stadiumArray[0].image.user === systemState.pov.user){
            stadiumElement.style.transform = 'scaleX(1) scaleY(1)';
        } else {
            stadiumElement.style.transform = 'scaleX(-1) scaleY(-1)';  
        };
    };

    //reload cards
    reloadBoard();
}