import { stadiumElement, attachedCardsElement, selfContainerDocument, benchArray, activeArray, oppActiveArray, oppAttachedCardsElement, oppBenchArray, oppContainerDocument, oppDeckCoverElement, oppDeckElement, oppDiscardCoverElement, oppLostZoneCoverElement, systemState, socket, lostZoneArray, discardArray, oppLostZoneArray, oppDiscardArray, handElement, deckArray, handArray, prizesArray} from '../../front-end.js'
import { resetImage } from '../../image-logic/reset-image.js';
import { getZoneCount, updateCount } from '../general/count.js';
import { deselectCard, hideElementsIfEmpty } from '../general/close-popups.js';
import { hideCard, revealCard } from '../general/reveal-and-hide.js';
import { stringToVariable } from '../../setup/zones/zone-string-to-variable.js';
import { addDamageCounter } from '../counters/damage-counter.js';
import { addSpecialCondition } from '../counters/special-condition.js';
import { addAbilityCounter } from '../counters/ability-counter.js';
import { sort } from '../general/sort.js';
import { matchRotation, resetRotation } from '../general/rotate-card.js';
import { moveCardMessage } from '../../setup/chatbox/move-card-message.js';
import { updateDestinationCover, updateOriginCover } from './update-cover.js';
import { updateAttachedCardsPosition } from './update-attached-cards-position.js';

export const moveCard = (user, oZoneArrayString, oZoneElementString, dZoneArrayString, dZoneElementString, index, targetIndex, emit = true) => {
    deselectCard(); //remove highlight from all images before moving cards

    // convert the string into the actual arrays/html elements
    const oZoneArray = stringToVariable(user, oZoneArrayString);
    const oZoneElement = stringToVariable(user, oZoneElementString);
    const dZoneArray = stringToVariable(user, dZoneArrayString);
    const dZoneElement = stringToVariable(user, dZoneElementString);

    // define the card that's being targeted, i.e., the pokemon that is being attached to, if a target index is defined
    let targetCard;
    if (typeof targetIndex === 'number'){
        targetCard = dZoneArray[targetIndex];
    };
    // define the card that's being moved
    const movingCard = oZoneArray[index];
    // move card from origin array to destination array
    dZoneArray.push(...oZoneArray.splice(index, 1));

    updateOriginCover(user, oZoneArrayString, index);
    
    // update the zIndex and positioning of any attached cards if they have shifted, i.e., shifting energies to the left if the movingcard an energy attached to a pokemon
    updateAttachedCardsPosition(oZoneArray, movingCard);
    
    // if the image was attached to another image, decrease the level of layering on the base image
    if (movingCard.image.target === 'on'){
        if (movingCard.type !== 'Pokémon'){
            movingCard.image.relative.energyLayer -= 1;
             //adjust width of container
             const adjustment = movingCard.image.relative.clientWidth/6;
             const currentWidth = parseFloat(movingCard.image.relative.parentElement.clientWidth);
             const newWidth = currentWidth - adjustment;
             movingCard.image.relative.parentElement.style.width = newWidth + 'px';
        } else {
            movingCard.image.relative.layer -= 1;
        };
    };

    //redraw trick
    const nonRedrawElements = ['activeElement', 'benchElement', 'attachedCardsElement'];
    if (!nonRedrawElements.includes(dZoneElementString)){
        hideCard(movingCard);
        revealCard(movingCard);
    };

    // determine whether to hide/reveal card
    const p1HideElements = ['prizesElement'];
    const p2HideElements = ['handElement'];
    if (p1HideElements.includes(dZoneElementString) || (p2HideElements.includes(dZoneElementString) && systemState.isTwoPlayer && systemState.pov.user !== user) 
    || (movingCard.image.faceDown && ['activeElement', 'benchElement', 'boardElement'].includes(dZoneElementString))){
        hideCard(movingCard);
        if (p1HideElements.includes(dZoneElementString) || (p2HideElements.includes(dZoneElementString))){
            movingCard.image.faceDown = false;
        };
    } else {
        revealCard(movingCard);
        movingCard.image.faceDown = false;
    };

    // first, check if image is being attached to another card
    const activeOrBenchElement = ['activeElement', 'benchElement'];
    if (targetCard
    && activeOrBenchElement.includes(dZoneElementString) 
    && !targetCard.image.attached
    && (!activeOrBenchElement.includes(oZoneElementString) || movingCard.image.attached)){
        if (movingCard.type === 'Pokémon' && !activeOrBenchElement.includes(oZoneElementString)){
            resetImage(movingCard.image);
            targetCard.image.after(movingCard.image);
            targetCard.image.relative = movingCard.image;
            //if counters exists, link the textcontent with the new Pokémon card
            if (targetCard.image.damageCounter){
                addDamageCounter(user, dZoneArrayString, dZoneElementString, dZoneArray.length - 1, false);
                movingCard.image.damageCounter.textContent = targetCard.image.damageCounter.textContent;
                //remove once opponent is finished with it
                targetCard.image.damageCounter.textContent = '0';
                targetCard.image.damageCounter.handleRemove();
            };
            if (targetCard.image.specialCondition){
                targetCard.image.specialCondition.textContent = '0';
                targetCard.image.specialCondition.handleRemove();
            };
            if (targetCard.image.abilityCounter){
                targetCard.image.abilityCounter.handleRemove();
            };
            //rotate card back to normal if it's not
            resetRotation(targetCard.image);

            //reset container width (since cards are being re-attached)
            const newWidth = parseFloat(movingCard.image.clientWidth);
            targetCard.image.parentElement.style.width = newWidth + 'px';

            // set relative of all of targetCard's attached cards to movingCard
            dZoneArray.forEach(card => { 
                if (card.image.relative === targetCard.image){
                    card.image.relative = movingCard.image;
                };
            });
            //move the cards to the new host
            for (let i = 0; i < dZoneArray.length; i++){
                const card = dZoneArray[i];
                if (card.image === movingCard.image){
                    break;
                } else if (card.image.relative === movingCard.image){
                    resetImage(card.image);
                    card.image.attached = true;
                    const targetIndex = dZoneArray.findIndex(card => card.image === movingCard.image);
                    moveCard(user, dZoneArrayString, dZoneElementString, dZoneArrayString, dZoneElementString, i, targetIndex, false);
                    i--;
                };
            };
        } else {
             //figure out where card is coming from-same parent or different? being reattached or evolve?
            const nonEvolveAttachment = movingCard.image.target === 'on' || !movingCard.image.parentElement.classList.contains('play-container');
             // format the card so it's attached to targetImage
            resetImage(movingCard.image);

            movingCard.image.attached = true;
            movingCard.image.target = 'on';
            movingCard.image.relative = targetCard.image;
            movingCard.image.style.position = 'absolute';

            let layer;
            if (movingCard.type !== 'Pokémon'){
                const adjustment = targetCard.image.clientWidth/6;
                targetCard.image.energyLayer += 1;
                layer = targetCard.image.energyLayer;
                movingCard.image.style.left = `${layer * adjustment}px`;
                
                //adjust width of container
                const currentWidth = parseFloat(targetCard.image.parentElement.clientWidth);
                const newWidth = currentWidth + adjustment;
                targetCard.image.parentElement.style.width = newWidth + 'px';
            } else {
                const adjustment = targetCard.image.clientWidth/14;
                targetCard.image.layer += 1;
                layer = targetCard.image.layer;
                movingCard.image.style.bottom = `${layer * adjustment}px`;
            };
            movingCard.image.style.zIndex -= layer;

            //rotate tool/energy to the same orientation of card
            matchRotation(movingCard.image, targetCard.image);

            targetCard.image.after(movingCard.image);

            // move tools to the back of the image, index cannot be zero to prevent being called when evolving Pokémon
            if (movingCard.type === 'Energy' && nonEvolveAttachment){
                for (let i = 0; i < getZoneCount(dZoneArray) - 1; i++){
                    if (dZoneArray[i].image.relative === movingCard.image.relative && !['Pokémon', 'Energy'].includes(dZoneArray[i].type)){
                        const targetIndex = dZoneArray.findIndex(card => card.image === movingCard.image.relative);
                        moveCard(user, dZoneArrayString, dZoneElementString, dZoneArrayString, dZoneElementString, i, targetIndex, false);
                        i--;
                    };
                    if (dZoneArray[i] === movingCard){
                        break;
                    };
                };
            };
        };
    } else {
        resetImage(movingCard.image, dZoneArrayString);
        if (activeOrBenchElement.includes(dZoneElementString)){
            let container;
            if (user === 'self'){
                container = selfContainerDocument.createElement('div');
            } else {
                container = oppContainerDocument.createElement('div');
            };
            if (movingCard.image.PokémonBreak && ['activeArray', 'benchArray'].includes(dZoneArrayString)){
                container.style.marginRight = '3%';
                container.style.marginLeft = '2%';
            };
            container.className = 'play-container';
            container.style.zIndex = '0';
            dZoneElement.appendChild(container);
            container.appendChild(movingCard.image);

            // delete the container if it's empty
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.removedNodes.length > 0){
                        const removedNode = mutation.removedNodes[0];
                        if (removedNode.nodeName === 'IMG' && container.getElementsByTagName('img').length === 0){
                            if (container.parentElement){
                                container.parentElement.style.zIndex = '0';
                            };
                            container.remove();
                        };
                        // update damage counters
                        if (['benchElement'].includes(dZoneElementString)){
                            let selectedBenchArray;
                            if (user === 'self'){
                                selectedBenchArray = benchArray;
                            } else {
                                selectedBenchArray = oppBenchArray;
                            }
                            for (let i = 0; i < getZoneCount(selectedBenchArray); i++){
                                const image = selectedBenchArray[i].image;
                                if (image.damageCounter){
                                    addDamageCounter(user, 'benchArray', 'benchElement', i, false);
                                };
                                if (image.abilityCounter){
                                    addAbilityCounter(user, 'benchArray', 'benchElement', i, false);
                                };
                            };
                        };
                        if (['activeElement'].includes(dZoneElementString)){
                            let selectedActiveArray;
                            if (user === 'self'){
                                selectedActiveArray = activeArray;
                            } else {
                                selectedActiveArray = oppActiveArray;
                            }
                            for (let i = 0; i < getZoneCount(selectedActiveArray); i++){
                                const image = selectedActiveArray[i].image;
                                if (image.damageCounter){
                                    addDamageCounter(user, 'activeArray', 'activeElement', i, false);
                                };
                                if (image.abilityCounter){
                                    addAbilityCounter(user, 'activeArray', 'activeElement', i, false);
                                };
                            };
                        };
                    };
                });
            });
        
            const config = { childList: true };
            observer.observe(container, config);

            const resizeObserver = new ResizeObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.target.parentElement && entry.target.parentElement.id === 'benchElement') {
                        for (let i = 0; i < getZoneCount(dZoneArray); i++) {
                            const image = dZoneArray[i].image;
                            if (image.damageCounter) {
                                addDamageCounter(user, 'benchArray', 'benchElement', i, false);
                            };
                            if (image.abilityCounter) {
                                addAbilityCounter(user, 'benchArray', 'benchElement', i, false);
                            };
                        };
                    };
                });
            });
            resizeObserver.observe(container);
        } else {
            dZoneElement.appendChild(movingCard.image);
        };

        const imageURL = movingCard.image.src;
        updateDestinationCover(user, dZoneArrayString, imageURL);

        //case 1: no target, moving benchArray card to active
        if (['activeElement'].includes(dZoneElementString) 
        && dZoneArray[1] //there is a card in active
        && !movingCard.image.attached //we are not attaching a card
        && !dZoneArray[0].image.attached){
            if (emit){
                moveCardMessage(systemState.pov.user, dZoneArray[0].name, 'activeArray', 'benchArray', 'move', false, dZoneArray[0].image.faceDown);
            };
            moveCard(user, 'activeArray', 'activeElement', 'benchArray', 'benchElement', 0, false, false);
        } else if (['benchElement'].includes(dZoneElementString) // case 2: no target, only one Pokémon on bench
        && ['activeElement'].includes(oZoneElementString)
        && dZoneArray.filter(card => !card.image.attached).length === 2
        && oZoneArray.filter(card => !card.image.attached).length === 0
        && !dZoneArray[0].image.attached){
            if (emit){
                moveCardMessage(systemState.pov.user, dZoneArray[0].name, 'benchArray', 'activeArray', 'move', false, dZoneArray[0].image.faceDown);
            };
            moveCard(user, 'benchArray', 'benchElement', 'activeArray', 'activeElement', 0, false, false);
        } else if (activeOrBenchElement.includes(dZoneElementString) //case 3: yes target, switch spots
        && targetCard
        && !movingCard.image.attached //we are not attaching a card
        && !dZoneArray[targetIndex].image.attached){
            if (emit){
                moveCardMessage(systemState.pov.user, dZoneArray[targetIndex].name, dZoneArrayString, oZoneArrayString, 'move', false, dZoneArray[targetIndex].image.faceDown);
            };
            moveCard(user, dZoneArrayString, dZoneElementString, oZoneArrayString, oZoneElementString, targetIndex, false, false);
        };
        if (['stadiumElement'].includes(dZoneElementString) && dZoneArray[1]) {
            if (dZoneArray[0].image.user === 'self') {
                moveCard('self', 'stadiumArray', 'stadiumElement', 'discardArray', 'discardElement', 0, false, false);
            } else {
                moveCard('opp', 'stadiumArray', 'stadiumElement', 'discardArray', 'discardElement', 0, false, false);
            };
        };
        
        if (stadiumElement === dZoneElement){
            if (user === systemState.pov.user){
                stadiumElement.style.transform = 'scaleX(1) scaleY(1)';
            } else {
                stadiumElement.style.transform = 'scaleX(-1) scaleY(-1)';  
            };
        };
    };
   
    const attachedElements = ['activeElement', 'benchElement', 'attachedCardsElement'];
    // deal with any attached cards
    if (attachedElements.includes(oZoneElementString) && !movingCard.image.attached){
        //create a reference to the original movingCard index so it's constant within this block
        for (let i = 0; i < oZoneArray.length; i++){
            const image = oZoneArray[i].image;
            if (image === movingCard.image){
                break;
            };
            if (image.relative === movingCard.image){
                resetImage(image);
                //moving to active or bench
                if (activeOrBenchElement.includes(dZoneElementString)){
                    image.attached = true;
                    const targetIndex = dZoneArray.findIndex(card => card.image === movingCard.image);
                    moveCard(user, oZoneArrayString, oZoneElementString, dZoneArrayString, dZoneElementString, i, targetIndex, false);
                } else {
                    if (oZoneArray[i].type === 'Pokémon' && movingCard.image.damageCounter){
                        addDamageCounter(user, oZoneArrayString, oZoneElementString, i, false);
                        image.damageCounter.textContent = movingCard.image.damageCounter.textContent;
                    };
                    if (user === 'self'){
                        attachedCardsElement.style.display = 'block';
                    } else {
                        oppAttachedCardsElement.style.display = 'block';
                    };
                    moveCard(user, oZoneArrayString, oZoneElementString, 'attachedCardsArray', 'attachedCardsElement', i, false, false);
                };
                i--;
            };
        };
    };
    // deal with damage counters
    if (movingCard.image.damageCounter){
        //redefine index of movingCard because its index could have changed due to attached cards.
        const index = dZoneArray.findIndex(card => card === movingCard);

        if (attachedElements.includes(dZoneElementString)){
            addDamageCounter(user, dZoneArrayString, dZoneElementString, index, false);
        } else {
            movingCard.image.damageCounter.textContent = '0';
            movingCard.image.damageCounter.handleRemove();
        };
    };
    if (movingCard.image.abilityCounter){
        //redefine index of movingCard because its index could have changed due to attached cards.
        const index = dZoneArray.findIndex(card => card === movingCard);

        if (attachedElements.includes(dZoneElementString)){
            addAbilityCounter(user, dZoneArrayString, dZoneElementString, index, false);
        } else {
            movingCard.image.abilityCounter.handleRemove();
        };
    };

    if (movingCard.image.specialCondition && !['activeElement'].includes(dZoneElementString)){
        movingCard.image.specialCondition.textContent = '0';
        movingCard.image.specialCondition.handleRemove();
    };
    //update damage counter placements
    if (attachedElements.includes(oZoneElementString)){
        for (let i = 0; i < oZoneArray.length; i++){
            const image = oZoneArray[i].image;
            if (image.damageCounter){
                addDamageCounter(user, oZoneArrayString, oZoneElementString, i, false);
            };
            if (image.specialCondition){
                addSpecialCondition(user, oZoneArrayString, oZoneElementString, i, false);
            };
            if (image.abilityCounter){
                addAbilityCounter(user, oZoneArrayString, oZoneElementString, i, false);
            };
        };
    };
    if (activeOrBenchElement.includes(dZoneElementString)){
        for (let i = 0; i < dZoneArray.length; i++){
            const image = dZoneArray[i].image;
            if (image.damageCounter){
                addDamageCounter(user, dZoneArrayString, dZoneElementString, i, false);
            };
            if (image.specialCondition){
                addSpecialCondition(user, dZoneArrayString, dZoneElementString, i, false);
            };
            if (image.abilityCounter){
                addAbilityCounter(user, dZoneArrayString, dZoneElementString, i, false);
            };
        };
    };
    if (!['activeArray', 'boardArray', 'benchArray', 'attachedCardsArray'].includes(dZoneArrayString) && movingCard.type2){
        movingCard.type = movingCard.type2;
    };
      
    updateCount();
    hideElementsIfEmpty();

    if (systemState.isTwoPlayer && emit){
        const oUser = user === 'self' ? 'opp' : 'self';
        const moveCardData = {
            roomId : systemState.roomId,
            user : oUser,
            oZoneArrayString: oZoneArrayString,
            oZoneElementString : oZoneElementString,
            dZoneArrayString : dZoneArrayString,
            dZoneElementString : dZoneElementString,
            index: index,
            targetIndex: targetIndex,
            emit: false
        };
        socket.emit('moveCard', moveCardData);
    };
    if (['deckArray', 'lostZoneArray', 'discardArray'].includes(dZoneArrayString)){
        sort(user, dZoneArrayString, dZoneElementString);
    };
}