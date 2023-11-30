import { deckDisplay_html, discardDisplay_html, lostzoneDisplay_html, prizes, selectedCard, selfContainersDocument, } from "../setup/initialization.js";
import { containerIdToLocation } from "../setup/container-reference.js";
import { deck_html, lostzone_html, discard_html } from "../setup/initialization.js";
import { oppDeck_html, oppDiscard_html, oppLostzone_html } from "../setup/opp-initialization.js";
import { stringToVariable, variableToString } from "../setup/string-to-variable.js";

export const cardPopup = document.getElementById('cardPopup');

function identifyCard(event){
    if (selfContainersDocument.body.contains(event.target)){
        selectedCard.oUser = 'opp';
        selectedCard.user = 'self';
    } else {
        selectedCard.oUser = 'self';
        selectedCard.user = 'opp';
    };

    selectedCard.containerId = event.target.parentElement.id;
    selectedCard.container = stringToVariable(selectedCard.user, selectedCard.containerId);
    selectedCard.location = containerIdToLocation(selectedCard.user, selectedCard.containerId);
    selectedCard.locationAsString = variableToString(selectedCard.user, selectedCard.location);
    selectedCard.index = selectedCard.location.cards.findIndex(card => card.image === event.target);
}

export function imageClick(event){
    event.stopPropagation();

    identifyCard(event);
    cardPopup.style.display = 'block';
}

export function deckCoverClick(event){
    if (event.target.parentElement === deckDisplay_html){
        deck_html.style.display = 'block';
    } else
		oppDeck_html.style.display = 'block';
}

export function discardCoverClick(event){
    if (event.target.parentElement === discardDisplay_html){
        discard_html.style.display = 'block';
    } else
        oppDiscard_html.style.display = 'block';
}

export function lostzoneCoverClick(event){
  if (event.target.parentElement === lostzoneDisplay_html){
      lostzone_html.style.display = 'block';
  } else
      oppLostzone_html.style.display = 'block';
}

export const cardContextMenu = document.getElementById('cardContextMenu');

export function openCardContextMenu(event){
    event.preventDefault();
    event.stopPropagation();

    identifyCard(event);

    cardContextMenu.style.left = '';
    cardContextMenu.style.top = '';
    cardContextMenu.style.right = '';
    cardContextMenu.style.bottom = '';

    const targetRect = event.target.getBoundingClientRect();
    if (event.target.user === 'self'){
        const oppContainersDocument = document.getElementById('oppContainers');
        cardContextMenu.style.left = `${targetRect.left}px`;
        cardContextMenu.style.top = `${targetRect.top + oppContainersDocument.offsetHeight}px`;
    } else {
        const selfContainersDocument = document.getElementById('selfContainers');
        const chatbox = document.getElementById('chatbox');
        cardContextMenu.style.right = `${targetRect.left + chatbox.offsetWidth}px`;
        cardContextMenu.style.bottom = `${targetRect.top + selfContainersDocument.offsetHeight}px`;
    };
    
    // Set the location of cardContextMenu based on the mouse coordinates
    const buttonConditions = {
        'damageCounterButton': [['self', 'active_html'], ['opp', 'active_html'], ['self', 'bench_html'], ['opp', 'bench_html']],
        'specialConditionButton': [['self', 'active_html'], ['opp', 'active_html']],
        'shufflePrizesButton': [['self', 'prizes_html']],
        'revealPrizesButton': [['self', 'prizes_html']],
        'hidePrizesButton': [['self', 'prizes_html']],
        'revealOppHandButton': [['opp', 'hand_html']],
        'hideOppHandButton': [['opp', 'hand_html']],
        'shuffleDeckButton': [['self', 'deckDisplay_html']],
        'drawButton': [['self', 'deckDisplay_html']],
        'viewTopButton': [['self', 'deckDisplay_html'], ['opp', 'deckDisplay_html']],
        'viewBottomButton': [['self', 'deckDisplay_html'], ['opp', 'deckDisplay_html']],
        'discardHandButton': [['self', 'hand_html']],
        'shuffleHandButton': [['self', 'hand_html']],
        'shuffleHandBottomButton': [['self', 'hand_html']],
    };
    
    for (const [buttonId, conditionsArray] of Object.entries(buttonConditions)){
        const button = document.getElementById(buttonId);
      
        // Check each condition array
        const shouldDisplay = conditionsArray.some(conditions => {
            const [userCondition, containerCondition] = conditions;
            return userCondition === selectedCard.user && containerCondition === selectedCard.containerId;
        });
      
        // Set display property based on conditions
        button.style.display = shouldDisplay ? 'block' : 'none';
    };

    const atLeastOneButtonVisible = Array.from(cardContextMenu.children)
    .some(button => button.style.display !== 'none');
    
    // Set the display property based on the visibility of buttons
    cardContextMenu.style.display = atLeastOneButtonVisible ? 'block' : 'none';
}
