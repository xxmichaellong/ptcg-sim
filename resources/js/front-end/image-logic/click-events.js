import { deckDisplay_html, discardDisplay_html, lostzoneDisplay_html, sCard, selfContainersDocument, } from "../setup/self-initialization.js";
import { containerIdToLocation } from "../setup/container-reference.js";
import { deck_html, lostzone_html, discard_html } from "../setup/self-initialization.js";
import { oppContainersDocument, oppDeck_html, oppDiscard_html, oppLostzone_html } from "../setup/opp-initialization.js";
import { stringToVariable, variableToString } from "../setup/string-to-variable.js";
import { addDamageCounter } from "../general-actions/damage-counter.js";
import { addSpecialCondition } from "../general-actions/special-condition.js";

export function identifyCard(event){
    if (event.target.user === 'self'){
        sCard.oUser = 'opp';
        sCard.user = 'self';
    } else {
        sCard.oUser = 'self';
        sCard.user = 'opp';
    };

    sCard.containerId = event.target.parentElement.id;
    if (!sCard.containerId){
        sCard.containerId = event.target.parentElement.parentElement.id;
    };
    sCard.container = stringToVariable(sCard.user, sCard.containerId);
    sCard.location = containerIdToLocation(sCard.user, sCard.containerId);
    sCard.locationAsString = variableToString(sCard.user, sCard.location);
  
    if (sCard.containerId === 'deckDisplay_html'){
        sCard.index = 0;
    } else {
        sCard.index = sCard.location.cards.findIndex(card => card.image === event.target);
    };
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
  } else {
      oppLostzone_html.style.display = 'block';
  }
}

export const cardContextMenu = document.getElementById('cardContextMenu');

export function openCardContextMenu(event){
    cardContextMenu.style.cssText = '';

    event.preventDefault();
    event.stopPropagation();

    identifyCard(event);
    
    const buttonConditions = {
        'damageCounterButton': [['self', 'active_html'], ['opp', 'active_html'], ['self', 'bench_html'], ['opp', 'bench_html']],
        'specialConditionButton': [['self', 'active_html'], ['opp', 'active_html']],
        'shufflePrizesButton': [['self', 'prizes_html']],
        'revealPrizesButton': [['self', 'prizes_html']],
        'hidePrizesButton': [['self', 'prizes_html']],
        'revealOppHandButton': [['opp', 'hand_html']],
        'hideOppHandButton': [['opp', 'hand_html']],
        'shuffleDeckButton': [['self', 'deckDisplay_html'], ['opp', 'deckDisplay_html']],
        'drawButton': [['self', 'deckDisplay_html']],
        'viewTopButton': [['self', 'deckDisplay_html'], ['opp', 'deckDisplay_html']],
        'viewBottomButton': [['self', 'deckDisplay_html'], ['opp', 'deckDisplay_html']],
        'discardHandButton': [['self', 'hand_html']],
        'shuffleHandButton': [['self', 'hand_html']],
        'shuffleHandBottomButton': [['self', 'hand_html']],
        'shuffleAllButton': [['self', 'viewCards_html'], ['opp', 'viewCards_html']],
        'discardAllButton': [['self', 'attachedCardPopup_html'], ['opp', 'attachedCardPopup_html']]
    };
    
    for (const [buttonId, conditionsArray] of Object.entries(buttonConditions)){
        const button = document.getElementById(buttonId);
      
        // Check each condition array
        const shouldDisplay = conditionsArray.some(conditions => {
            const [userCondition, containerCondition] = conditions;
            return userCondition === sCard.user && containerCondition === sCard.containerId;
        });
      
        // Set display property based on conditions
        button.style.display = shouldDisplay ? 'block' : 'none';
    };

    const atLeastOneButtonVisible = Array.from(cardContextMenu.children)
    .some(button => button.style.display !== 'none');
    
    // Set the display property based on the visibility of buttons
    cardContextMenu.style.display = atLeastOneButtonVisible ? 'block' : 'none';

    // get the fucking position of this mf
    const targetRect = event.target.getBoundingClientRect();
    const offsetHeight = (event.target.user === 'self') ? document.getElementById('oppContainers').offsetHeight : document.getElementById('selfContainers').offsetHeight;
    
    if (selfContainersDocument.body.contains(event.target)){
        if (event.target.parentElement.id === 'deckDisplay_html'){
            cardContextMenu.style.left = `${targetRect.left - cardContextMenu.clientWidth}px`;
            cardContextMenu.style.top = `${targetRect.top + offsetHeight}px`; 
        }
        else if (event.target.parentElement.id === 'hand_html'){
            cardContextMenu.style.left = `${targetRect.left}px`;
            cardContextMenu.style.top = `${targetRect.top + offsetHeight - cardContextMenu.offsetHeight}px`; 
        }
        else {
            cardContextMenu.style.left = `${targetRect.left + event.target.clientWidth}px`;
            cardContextMenu.style.top = `${targetRect.top + offsetHeight}px`; 
        };
    } else if (oppContainersDocument.body.contains(event.target)){
        const chatbox = document.getElementById('chatbox');
        if (event.target.parentElement.id === 'deckDisplay_html'){
            cardContextMenu.style.right = `${targetRect.left + chatbox.offsetWidth - cardContextMenu.clientWidth}px`;
            cardContextMenu.style.bottom = `${targetRect.top + offsetHeight - cardContextMenu.offsetHeight + event.target.offsetHeight}px`;
        } else if (event.target.parentElement.id === 'prizes_html'){
            cardContextMenu.style.right = `${targetRect.left + chatbox.offsetWidth + event.target.clientWidth}px`;
            cardContextMenu.style.bottom = `${targetRect.top + offsetHeight - cardContextMenu.offsetHeight + event.target.offsetHeight}px`;
        } else {
            cardContextMenu.style.right = `${targetRect.left + chatbox.offsetWidth - cardContextMenu.clientWidth + event.target.clientWidth}px`;
            cardContextMenu.style.bottom = `${targetRect.top + offsetHeight - cardContextMenu.offsetHeight}px`;
        };
    } else {
        cardContextMenu.style.left = `${targetRect.left}px`;
        cardContextMenu.style.top = `${targetRect.top - cardContextMenu.offsetHeight}px`;
    };
}

export const cardPopup = document.getElementById('cardPopup');

export function imageClick(event){
    event.stopPropagation();

    identifyCard(event);

    if (['bench_html', 'active_html'].includes(sCard.containerId)){
        const images = event.target.parentElement.querySelectorAll('img');
        images.forEach(function(img){
            if (img.attached){
                img.style.position = "static";
            };
        });
        event.target.parentElement.className = 'fullView';
        event.target.parentElement.style.zIndex = '2';
        event.target.parentElement.style.height = '50%';
        event.target.parentElement.style.width = '69%';

        if (event.target.damageCounter){
            event.target.damageCounter.style.display = 'none';
        };
        if (event.target.specialCondition){
            event.target.specialCondition.style.display = 'none';
        };
        sCard.container.style.zIndex = '2';
    };
}