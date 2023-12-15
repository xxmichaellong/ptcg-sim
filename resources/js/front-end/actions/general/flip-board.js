import { POV, board_html, oppBoard_html, oppContainers, oppContainersDocument, oppResizer, selfContainers, selfContainersDocument, selfResizer, stadium, stadium_html } from '../../front-end.js';
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
    }

    const toggleClasses = (element, class1, class2) => {
        element.classList.toggle(class1);
        element.classList.toggle(class2);
    }

    toggleClasses(selfResizer, 'selfColour', 'oppColour');
    toggleClasses(oppResizer, 'oppColour', 'selfColour');
    toggleClasses(selfContainers, 'self', 'opp');
    toggleClasses(oppContainers, 'opp', 'self');
    toggleClasses(board_html, 'selfBoard', 'oppBoard');
    toggleClasses(oppBoard_html, 'oppBoard', 'selfBoard');
      

    const users = ['self', 'opp'];
    const textIds = ['deckText', 'discardText', 'lostzoneText'];
    const containerIds = ['deck_html', 'discard_html', 'lostzone_html', 'attachedCardPopup_html', 'viewCards_html'];
    const buttonIds = ['viewCardsButtonContainer', 'attachedCardPopupButtonContainer'];
    const headerIds = ['attachedCardPopupHeader', 'viewCardsHeader']

    for (const user of users) {
        const document = user === 'self' ? selfContainersDocument : oppContainersDocument;
    
        for (const textId of textIds) {
            const text = document.getElementById(textId);
            text.classList.toggle('self-text');
            text.classList.toggle('opp-text');
        }
        for (const containerId of containerIds) {
            const container = document.getElementById(containerId);
            container.classList.toggle('self-view');
            container.classList.toggle('opp-view');
        }
        for (const buttonId of buttonIds) {
            const button = document.getElementById(buttonId);
            button.classList.toggle('self-button-container');
            button.classList.toggle('opp-button-container');
        }
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
    }
    
    
    // Swap heights
    let tempHeight = selfContainers.style.height;
    selfContainers.style.height = oppContainers.style.height;
    oppContainers.style.height = tempHeight;

    // Swap bottom lengths
    let tempBottom = selfContainers.style.bottom;
    selfContainers.style.bottom = oppContainers.style.bottom;
    oppContainers.style.bottom = tempBottom;
    
    // Flip the stadium
    if (stadium.cards[0]){
        if (stadium.cards[0].image.user === POV.user){
            stadium_html.style.transform = 'scaleX(1) scaleY(1)';
        } else {
            stadium_html.style.transform = 'scaleX(-1) scaleY(-1)';  
        };
    };

    //reload cards
    reloadBoard();
}