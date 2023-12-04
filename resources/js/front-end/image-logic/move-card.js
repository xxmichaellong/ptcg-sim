import { lostzone_html, prizes_html, lostzoneDisplay_html, discard_html, discard, 
    discardDisplay_html, deck_html, deckDisplay_html, bench_html, active_html, hand_html, stadium_html, stadium, attachedCardPopup, attachedCardPopup_html, selfContainersDocument, bench } from "../setup/self-initialization.js";
import { resetImage } from "./reset-image.js";
import { updateCount } from "../setup/counts.js";
import { makeLostzoneCover } from "../card-types/lostzone-cover.js";
import { makeDiscardCover } from "../card-types/discard-cover.js";
import { hideIfEmpty } from "../setup/close-popups.js";
import { hideCard, revealCard } from "../general-actions/reveal-and-hide.js";
import { stringToVariable } from "../setup/string-to-variable.js";
import { oppActive_html, oppAttachedCardPopup_html, oppBench, oppBench_html, oppContainersDocument, oppDeckDisplay_html, oppDeck_html, oppDiscardDisplay_html, oppDiscard_html, oppHand_html, oppLostzoneDisplay_html, oppLostzone_html, oppPrizes_html, oppViewCards_html } from "../setup/opp-initialization.js";
import { makeDeckCover } from "../card-types/deck-cover.js";
import { socket } from "../setup/socket.js";
import { addDamageCounter } from "../general-actions/damage-counter.js";
import { roomId } from "../start-page/generate-id.js";

export function moveCard(user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex){
    // create references to the string in case it needs to be used later for recalling moveCard (e.g., appending attached cards);
    const _oLocation = oLocation;
    const _oLocation_html = oLocation_html;
    const _mLocation = mLocation;
    const _mLocation_html = mLocation_html;

    oLocation = stringToVariable(user, oLocation);
    oLocation_html = stringToVariable(user, oLocation_html);
    mLocation = stringToVariable(user, mLocation);
    mLocation_html = stringToVariable(user, mLocation_html);

    let targetCard;
    if (typeof targetIndex === 'number'){
        targetCard = mLocation.cards[targetIndex];
    };

    // move card from origin array to new location array
    const movingCard = oLocation.cards[index];
    mLocation.cards.push(...oLocation.cards.splice(index, 1));

    // dealing with lostzone/discard cover, check if index is equal to the length of array (after removal)
    if ([lostzone_html, discard_html, oppDiscard_html, oppLostzone_html].includes(oLocation_html) && index === oLocation.cards.length){
        // remove existing cover image
        let display_html;
        if (oLocation_html === lostzone_html){
            display_html = lostzoneDisplay_html;
        } else if (oLocation_html === discard_html){
            display_html = discardDisplay_html;
        } else if (oLocation_html === oppLostzone_html){
            display_html = oppLostzoneDisplay_html;
        } else if (oLocation_html === oppDiscard_html){
            display_html = oppDiscardDisplay_html;
        };

        display_html.removeChild(display_html.firstElementChild);
        // append new cover image if there are still cards
        if (oLocation.cards.length > 0){
            const src = oLocation.cards[oLocation.cards.length - 1].image.src;
            let cover;
            if (oLocation_html === lostzone_html){
                cover = makeLostzoneCover(user, src);
            } else if (oLocation_html === discard_html){
                cover = makeDiscardCover(user, src);
            } else if (oLocation_html === oppLostzone_html){
                cover = makeLostzoneCover(user, src);
            } else if (oLocation_html === oppDiscard_html){
                cover = makeDiscardCover(user, src);
            };
            display_html.appendChild(cover.image);
        };
    } else if ([deck_html, oppDeck_html].includes(oLocation_html) && oLocation.cards.length === 0){
        let display_html;
        if (oLocation_html === deck_html){
            display_html = deckDisplay_html;
        } else if (oLocation_html === oppDeck_html){
            display_html = oppDeckDisplay_html;
        }
        display_html.removeChild(display_html.firstElementChild);
    };
    
    // update the zIndex and height of each card if the card was attached to the same card and located higher
    oLocation.cards.forEach(card => {
        let cardPosition;
        let movingCardPosition;
        if (card.type === 'energy' && movingCard.type == 'energy'){
            cardPosition = card.image.style.left;
            movingCardPosition = movingCard.image.style.left;

            if (movingCard.image.relative instanceof HTMLImageElement && movingCard.image.relative === card.image.relative 
            && parseInt(cardPosition) > parseInt(movingCardPosition)){
                card.image.style.left = (parseInt(cardPosition) - card.image.relative.adjustment) + 'px';
                card.image.style.zIndex = (parseInt(card.image.style.zIndex) + 1).toString();
            };

        } else {
            cardPosition = card.image.style.bottom;
            movingCardPosition = movingCard.image.style.bottom;

            if (movingCard.image.relative instanceof HTMLImageElement && movingCard.image.relative === card.image.relative 
            && parseInt(cardPosition) > parseInt(movingCardPosition) && movingCard.type !== 'energy'){
                card.image.style.bottom = (parseInt(cardPosition) - card.image.relative.adjustment) + 'px';
                card.image.style.zIndex = (parseInt(card.image.style.zIndex) + 1).toString();
            };
        };
    });

    // if the image was attached to another image, decrease the level of layering on the base image
    if (movingCard.image.target === 'on'){
        if (movingCard.type === 'energy'){
            movingCard.image.relative.energyLayer -= 1;
             //adjust width of container
             const currentWidth = parseFloat(movingCard.image.relative.parentElement.clientWidth);
             const newWidth = currentWidth - movingCard.image.relative.adjustment;
             movingCard.image.relative.parentElement.style.width = newWidth + 'px';
        } else {
            movingCard.image.relative.layer -= 1;
        };
    };

    //redraw trick
    if (![active_html, bench_html, oppActive_html, oppBench_html, attachedCardPopup_html, oppAttachedCardPopup_html].includes(mLocation_html)){
        hideCard(movingCard);
        revealCard(movingCard);
    };

    // determine whether to hide/reveal card
    if ([prizes_html, oppPrizes_html, oppHand_html, oppViewCards_html].includes(mLocation_html)){
        hideCard(movingCard);
     } else {
        revealCard(movingCard);
    };

    // first, check if image is being attached to another card
    if (targetCard
    && [active_html, bench_html, oppActive_html, oppBench_html].includes(mLocation_html) 
    && !targetCard.image.attached
    && (![active_html, bench_html, oppActive_html, oppBench_html].includes(oLocation_html) || movingCard.image.attached)){
        if (movingCard.type === 'pokemon' && ![active_html, bench_html, oppActive_html, oppBench_html].includes(oLocation_html)){
            targetCard.image.after(movingCard.image);
            targetCard.image.attached = true;
            targetCard.image.relative = movingCard.image;
            //if damage counter exists, link the textcontent with the new pokemon card
            if (targetCard.image.damageCounter){
                addDamageCounter(user, _mLocation, _mLocation_html, mLocation.cards.length - 1);
                movingCard.image.damageCounter.textContent = targetCard.image.damageCounter.textContent;
                //remove once opponent is finished with it
                targetCard.image.damageCounter.textContent = '0';
                targetCard.image.damageCounter.handleRemove();
            };
            //reset container width (since cards are being re-attached)
            const newWidth = parseFloat(movingCard.image.clientWidth);
            targetCard.image.parentElement.style.width = newWidth + 'px';

            // set relative of all of targetCard's attached cards to movingCard
            mLocation.cards.forEach(card => { 
                if(card.image.relative === targetCard.image){
                    card.image.relative = movingCard.image;
                };
            });
            //move the cards to the new host
            let movingCardIndex = mLocation.cards.length - 1;
            for (let i = 0; i < mLocation.cards.length; i++){
                const card = mLocation.cards[i];
                if (card.image === movingCard.image){
                    break;
                } else if (card.image.relative === movingCard.image){
                    resetImage(card.image);
                    card.image.attached = true;
                    moveCard(user, _mLocation, _mLocation_html, _mLocation, _mLocation_html, i, movingCardIndex);
                    movingCardIndex--;
                    i--;
                };
            };
        } else {
            // format the card so it's attached to targetImage
            movingCard.image.attached = true;
            movingCard.image.target = 'on';
            movingCard.image.relative = targetCard.image;
            movingCard.image.style.position = 'absolute';

            let layer;
            if (movingCard.type === 'energy'){
                targetCard.image.adjustment = targetCard.image.clientWidth/6;
                targetCard.image.energyLayer += 1;
                layer = targetCard.image.energyLayer;
                movingCard.image.style.left = `${layer * targetCard.image.adjustment}px`;
                
                //adjust width of container
                const currentWidth = parseFloat(targetCard.image.parentElement.clientWidth);
                const newWidth = currentWidth + targetCard.image.adjustment;
                targetCard.image.parentElement.style.width = newWidth + 'px';
            } else {
                targetCard.image.adjustment = targetCard.image.clientWidth/6;
                targetCard.image.layer += 1;
                layer = targetCard.image.layer;
                movingCard.image.style.bottom = `${layer * targetCard.image.adjustment}px`;
            };
            movingCard.image.style.zIndex -= layer;
            targetCard.image.after(movingCard.image);
        };
    } else {
        resetImage(movingCard.image);
        // adjust create a div container for active/bench
        if (['bench', 'active'].includes(_mLocation)){
            let container;
            if (user === 'self'){
                container = selfContainersDocument.createElement('div');
            } else {
                container = oppContainersDocument.createElement('div');
            };
            container.className = 'playContainer';
            mLocation_html.appendChild(container);
            container.appendChild(movingCard.image);

            // some jank code  that deletes the container if it's empty
            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.removedNodes.length > 0) {
                        const removedNode = mutation.removedNodes[0];
                        if (removedNode.nodeName === 'IMG' && container.getElementsByTagName('img').length === 0) {
                            container.remove();
                        };
                        // update damage counters
                        if (['bench_html'].includes(_mLocation_html)){
                            let sBench;
                            if (user === 'self'){
                                sBench = bench;
                            } else {
                                sBench = oppBench;
                            }
                            for (let i = 0; i < sBench.count; i++){
                                const image = sBench.cards[i].image;
                                if (image.damageCounter){
                                    addDamageCounter(user, 'bench', 'bench_html', i);
                                };
                            };
                        };
                    };
                });
            });
        
            const config = { childList: true };
            observer.observe(container, config);
        } else {
            mLocation_html.appendChild(movingCard.image);
        }
        //update discard/lostzone cover
        if ([lostzone_html, discard_html, oppLostzone_html, oppDiscard_html].includes(mLocation_html)){
            let display_html;
            let cover;
            if (mLocation_html === lostzone_html){
                display_html = lostzoneDisplay_html;
                cover = makeLostzoneCover(user, movingCard.image.src);
            } else if (mLocation_html === discard_html){
                display_html = discardDisplay_html;
                cover = makeDiscardCover(user, movingCard.image.src);
            } else if (mLocation_html === oppLostzone_html){
                display_html = oppLostzoneDisplay_html;
                cover = makeLostzoneCover(user, movingCard.image.src);
            } else if (mLocation_html === oppDiscard_html){
                display_html = oppDiscardDisplay_html;
                cover = makeDiscardCover(user, movingCard.image.src);
            };
            //remove any existing image
            if (display_html.firstElementChild){
                display_html.removeChild(display_html.firstElementChild);
            };
            display_html.appendChild(cover.image);
        //add deck cover if it's the first card
        } else if ([deck_html, oppDeck_html].includes(mLocation_html) && mLocation.cards.length === 1){
            let display_html;
            if (mLocation_html === deck_html){
                display_html = deckDisplay_html;
            } else if (mLocation_html === oppDeck_html){
                display_html = oppDeckDisplay_html;
            };
            display_html.appendChild(makeDeckCover(user).image);
        //move active card to the bench if it exists
        } else if ([active_html, oppActive_html].includes(mLocation_html) 
        && mLocation.cards[1] 
        && !movingCard.image.attached){
            moveCard(user, 'active', 'active_html', 'bench', 'bench_html', 0);
        //remove any existing stadium and send to correct discard pile
        } else if (stadium_html === mLocation_html && mLocation.cards[1] && user === 'self'){
            if (mLocation.cards[0].image.user === 'self'){
                moveCard('self', 'stadium', 'stadium_html', 'discard', 'discard_html', 0);
                socket.emit('moveCard', roomId, 'opp', 'stadium', 'stadium_html', 'discard', 'discard_html', 0)
            } else {
                moveCard('opp', 'stadium', 'stadium_html', 'discard', 'discard_html', 0);
                socket.emit('moveCard', roomId, 'self', 'stadium', 'stadium_html', 'discard', 'discard_html', 0)
            };
        };
        if (stadium_html === mLocation_html){
            if (user === 'self'){
                stadium_html.style.transform = 'scaleX(1) scaleY(1)';
            } else {
                stadium_html.style.transform = 'scaleX(-1) scaleY(-1)';  
            };
        };
    };
   
    // deal with any attached cards
    if ([active_html, bench_html, oppActive_html, oppBench_html, attachedCardPopup_html, oppAttachedCardPopup_html].includes(oLocation_html)){
        //create a reference to the original movingCard index so it's constant within this block
        let movingCardIndex = mLocation.cards.length - 1;
        for (let i = 0; i < oLocation.cards.length; i++){
            const image = oLocation.cards[i].image;
            if (image === movingCard.image){
                break;
            };
            if (image.relative === movingCard.image){
                resetImage(image);
                //moving to active or bench
                if ([active_html, bench_html, oppActive_html, oppBench_html].includes(mLocation_html)){
                    image.attached = true;
                    moveCard(user, _oLocation, _oLocation_html, _mLocation, _mLocation_html, i, movingCardIndex);
                    //moving from empty/filled to empty
                    //no change to index
                    //moving from empty to empty/filled
                    //no change
                    //moving from filled to different filled
                    //no change
                    //moving from filled to same filled (last card)
                    //no change
                    //moving from filled to same filled (not last card)
                    if (_oLocation === _mLocation && index !== movingCardIndex){
                        movingCardIndex--;
                    };
                //moving to other part of deck, open a popup to move the cards
                } else {
                    if (oLocation.cards[i].type === 'pokemon' && movingCard.image.damageCounter){
                        addDamageCounter(user, _oLocation, _oLocation_html, i);
                        image.damageCounter.textContent = movingCard.image.damageCounter.textContent;
                    };
                    if (user === 'self'){
                        attachedCardPopup_html.style.display = 'block';
                    } else {
                        oppAttachedCardPopup_html.style.display = 'block';
                    };
                    moveCard(user, _oLocation, _oLocation_html, 'attachedCardPopup', 'attachedCardPopup_html', i);
                };
                i--;
            };
        };
    };
    // deal with damage counters
    if (movingCard.image.damageCounter){
        //redefine index of movingCard because its location could have moved due to attached cards.
        const index = mLocation.cards.findIndex(card => card === movingCard);

        if ([active_html, bench_html, oppActive_html, oppBench_html, attachedCardPopup_html, oppAttachedCardPopup_html].includes(mLocation_html)){
            addDamageCounter(user, _mLocation, _mLocation_html, index);
        } else {
            movingCard.image.damageCounter.textContent = '0';
            movingCard.image.damageCounter.handleRemove();
        };
    };

    if (movingCard.image.specialCondition && ![active_html, oppActive_html].includes(mLocation_html)){
        movingCard.image.specialCondition.textContent = '0';
        movingCard.image.specialCondition.handleRemove();
    };
    //update damage counter locations
    if ([active_html, bench_html, oppActive_html, oppBench_html, attachedCardPopup_html, oppAttachedCardPopup_html].includes(oLocation_html)){
        for (let i = 0; i < oLocation.cards.length; i++){
            const image = oLocation.cards[i].image;
            if (image.damageCounter){
                addDamageCounter(user, _oLocation, _oLocation_html, i);
            };
        };
    };
    if (['active_html', 'bench_html'].includes(_mLocation_html)){
        for (let i = 0; i < mLocation.cards.length; i++){
            const image = mLocation.cards[i].image;
            if (image.damageCounter){
                addDamageCounter(user, _mLocation, _mLocation_html, i);
            };
        };
    };

    updateCount();
    hideIfEmpty(user, _oLocation_html);
}