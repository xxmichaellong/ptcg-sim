import { p1, lostzone_html, lostzoneDisplay_html, discard_html,
    discardDisplay_html, deck_html, deckDisplay_html, stadium_html, attachedCardPopup_html, selfContainersDocument, bench, active, oppActive, oppAttachedCardPopup_html, oppBench, oppContainersDocument, oppDeckDisplay_html, oppDeck_html, oppDiscardDisplay_html, oppDiscard_html, oppLostzoneDisplay_html, oppLostzone_html, POV, oppPrizes_html, oppHand_html, oppViewCards_html, roomId, socket} from '../../front-end.js'
import { resetImage } from '../../image-logic/reset-image.js';
import { updateCount } from './update-count.js';
import { makeLostzoneCover } from '../make-cover/lostzone-cover.js';
import { makeDiscardCover } from '../make-cover/discard-cover.js';
import { makeDeckCover } from '../make-cover/deck-cover.js';
import { deselectCard, hideIfEmpty } from './close-popups.js';
import { hideCard, revealCard } from './reveal-and-hide.js';
import { stringToVariable } from '../../setup/containers/string-to-variable.js';
import { addDamageCounter } from '../counters/damage-counter.js';
import { addSpecialCondition } from '../counters/special-condition.js';
import { addAbilityCounter } from '../counters/ability-counter.js';

export const moveCard = (user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex, received = false) => {
    deselectCard(); //remove highlight from all images before it's moved
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
    if (['lostzone_html', 'discard_html'].includes(_oLocation_html) && index === oLocation.cards.length){
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
    } else if (['deck_html'].includes(_oLocation_html) && oLocation.cards.length === 0){
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
        if (card.type !== 'pokemon' && movingCard.type !== 'pokemon'){
            cardPosition = card.image.style.left;
            movingCardPosition = movingCard.image.style.left;

            if (movingCard.image.relative instanceof HTMLImageElement && movingCard.image.relative === card.image.relative 
            && parseInt(cardPosition) > parseInt(movingCardPosition)){
                const adjustment = movingCard.image.relative.clientWidth/6;
                card.image.style.left = (parseInt(cardPosition) - adjustment) + 'px';
                card.image.style.zIndex = (parseInt(card.image.style.zIndex) + 1).toString();
            };

        } else {
            cardPosition = card.image.style.bottom;
            movingCardPosition = movingCard.image.style.bottom;

            if (movingCard.image.relative instanceof HTMLImageElement && movingCard.image.relative === card.image.relative 
            && parseInt(cardPosition) > parseInt(movingCardPosition) && movingCard.type === 'pokemon'){
                const adjustment = movingCard.image.relative.clientWidth/14;
                card.image.style.bottom = (parseInt(cardPosition) - adjustment) + 'px';
                card.image.style.zIndex = (parseInt(card.image.style.zIndex) + 1).toString();
            };
        };
    });

    // if the image was attached to another image, decrease the level of layering on the base image
    if (movingCard.image.target === 'on'){
        if (movingCard.type !== 'pokemon'){
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
    const nonRefreshLocations = ['active_html', 'bench_html', 'attachedCardPopup_html'];
    if (!nonRefreshLocations.includes(_mLocation_html)){
        hideCard(movingCard);
        revealCard(movingCard);
    };

    // determine whether to hide/reveal card
    const p1HideLocations = ['prizes_html'];
    const p2HideLocations = ['hand_html'];
    if (p1HideLocations.includes(_mLocation_html) || (p2HideLocations.includes(_mLocation_html) && !p1[0] && POV.user !== user)){
        hideCard(movingCard);
    } else {
        revealCard(movingCard);
    };

    // first, check if image is being attached to another card
    const boardLocations = ['active_html', 'bench_html'];
    if (targetCard
    && boardLocations.includes(_mLocation_html) 
    && !targetCard.image.attached
    && (!boardLocations.includes(_oLocation_html) || movingCard.image.attached)){
        if (movingCard.type === 'pokemon' && !boardLocations.includes(_oLocation_html)){
            targetCard.image.after(movingCard.image);
            targetCard.image.attached = true;
            targetCard.image.relative = movingCard.image;
            //if counters exists, link the textcontent with the new pokemon card
            if (targetCard.image.damageCounter){
                addDamageCounter(user, _mLocation, _mLocation_html, mLocation.cards.length - 1, true);
                movingCard.image.damageCounter.textContent = targetCard.image.damageCounter.textContent;
                //remove once opponent is finished with it
                targetCard.image.damageCounter.textContent = '0';
                targetCard.image.damageCounter.handleRemove();
            };
            if (targetCard.image.specialCondition){
                addSpecialCondition(user, _mLocation, _mLocation_html, mLocation.cards.length - 1, true);
                movingCard.image.specialCondition.textContent = targetCard.image.specialCondition.textContent;
                //remove once opponent is finished with it
                targetCard.image.specialCondition.textContent = '0';
                targetCard.image.specialCondition.handleRemove();
            };
            if (targetCard.image.abilityCounter){
                addAbilityCounter(user, _mLocation, _mLocation_html, mLocation.cards.length - 1, true);
                //remove once opponent is finished with it
                targetCard.image.abilityCounter.handleRemove();
            };
            //reset container width (since cards are being re-attached)
            const newWidth = parseFloat(movingCard.image.clientWidth);
            targetCard.image.parentElement.style.width = newWidth + 'px';

            // set relative of all of targetCard's attached cards to movingCard
            mLocation.cards.forEach(card => { 
                if (card.image.relative === targetCard.image){
                    card.image.relative = movingCard.image;
                };
            });
            //move the cards to the new host
            for (let i = 0; i < mLocation.cards.length; i++){
                const card = mLocation.cards[i];
                if (card.image === movingCard.image){
                    break;
                } else if (card.image.relative === movingCard.image){
                    resetImage(card.image);
                    card.image.attached = true;
                    const targetIndex = mLocation.cards.findIndex(card => card.image === movingCard.image);
                    moveCard(user, _mLocation, _mLocation_html, _mLocation, _mLocation_html, i, targetIndex, true);
                    i--;
                };
            };
        } else {
             //figure out where card is coming from-same parent or different? being reattached or evolve?
            const nonEvolveAttachment = movingCard.image.target === 'on' || !movingCard.image.parentElement.classList.contains('playContainer');
             // format the card so it's attached to targetImage
            resetImage(movingCard.image);

            movingCard.image.attached = true;
            movingCard.image.target = 'on';
            movingCard.image.relative = targetCard.image;
            movingCard.image.style.position = 'absolute';

            let layer;
            if (movingCard.type !== 'pokemon'){
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
            targetCard.image.after(movingCard.image);

            // move tools to the back of the image, index cannot be zero to prevent being called when evolving pokemon
            if (movingCard.type === 'energy' && nonEvolveAttachment){
                for (let i = 0; i < mLocation.count - 1; i++){
                    if (mLocation.cards[i].image.relative === movingCard.image.relative && !['pokemon', 'energy'].includes(mLocation.cards[i].type)){
                        const targetIndex = mLocation.cards.findIndex(card => card.image === movingCard.image.relative);
                        moveCard(user, _mLocation, _mLocation_html, _mLocation, _mLocation_html, i, targetIndex, true);
                        i--;
                    };
                    if (mLocation.cards[i] === movingCard){
                        break;
                    };
                };
            };
        };
    } else {
        resetImage(movingCard.image);
        // adjust create a div container for active/bench
        if (boardLocations.includes(_mLocation_html)){
            let container;
            if (user === 'self'){
                container = selfContainersDocument.createElement('div');
            } else {
                container = oppContainersDocument.createElement('div');
            };
            container.className = 'playContainer';
            container.style.zIndex = '0';
            mLocation_html.appendChild(container);
            container.appendChild(movingCard.image);

            // some jank code that deletes the container if it's empty
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
                                    addDamageCounter(user, 'bench', 'bench_html', i, true);
                                };
                                if (image.abilityCounter){
                                    addAbilityCounter(user, 'bench', 'bench_html', i, true);
                                };
                            };
                        };
                        if (['active_html'].includes(_mLocation_html)){
                            let sActive;
                            if (user === 'self'){
                                sActive = active;
                            } else {
                                sActive = oppActive;
                            }
                            for (let i = 0; i < sActive.count; i++){
                                const image = sActive.cards[i].image;
                                if (image.damageCounter){
                                    addDamageCounter(user, 'active', 'active_html', i, true);
                                };
                                if (image.abilityCounter){
                                    addAbilityCounter(user, 'active', 'active_html', i, true);
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
                    if (entry.target.parentElement && entry.target.parentElement.id === 'bench_html') {
                        for (let i = 0; i < mLocation.count; i++) {
                            const image = mLocation.cards[i].image;
                            if (image.damageCounter) {
                                addDamageCounter(user, 'bench', 'bench_html', i, true);
                            };
                            if (image.abilityCounter) {
                                addAbilityCounter(user, 'bench', 'bench_html', i, true);
                            };
                        };
                    };
                });
            });
            resizeObserver.observe(container);

        } else {
            mLocation_html.appendChild(movingCard.image);
        }
        //update discard/lostzone cover
        if (['lostzone_html', 'discard_html'].includes(_mLocation_html)){
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
        } else if (['deck_html'].includes(_mLocation_html) && mLocation.cards.length === 1){
            let display_html;
            if (mLocation_html === deck_html){
                display_html = deckDisplay_html;
            } else if (mLocation_html === oppDeck_html){
                display_html = oppDeckDisplay_html;
            };
            display_html.appendChild(makeDeckCover(user).image);
        //move active card to the bench if it exists
        } else if (['active_html'].includes(_mLocation_html) 
        && mLocation.cards[1] 
        && !movingCard.image.attached
        && !mLocation.cards[0].image.attached){
            moveCard(user, 'active', 'active_html', 'bench', 'bench_html', 0, false, true);
        };
        
        if (['stadium_html'].includes(_mLocation_html) && mLocation.cards[1]) {
            if (mLocation.cards[0].image.user === 'self') {
                moveCard('self', 'stadium', 'stadium_html', 'discard', 'discard_html', 0, false, true);
            } else {
                moveCard('opp', 'stadium', 'stadium_html', 'discard', 'discard_html', 0, false, true);
            };
        };
        
        if (stadium_html === mLocation_html){
            if (user === POV.user){
                stadium_html.style.transform = 'scaleX(1) scaleY(1)';
            } else {
                stadium_html.style.transform = 'scaleX(-1) scaleY(-1)';  
            };
        };
    };
   
    const attachedLocations = ['active_html', 'bench_html', 'attachedCardPopup_html'];
    // deal with any attached cards
    if (attachedLocations.includes(_oLocation_html) && !movingCard.image.attached){
        //create a reference to the original movingCard index so it's constant within this block
        for (let i = 0; i < oLocation.cards.length; i++){
            const image = oLocation.cards[i].image;
            if (image === movingCard.image){
                break;
            };
            if (image.relative === movingCard.image){
                resetImage(image);
                //moving to active or bench
                if (boardLocations.includes(_mLocation_html)){
                    image.attached = true;
                    const targetIndex = mLocation.cards.findIndex(card => card.image === movingCard.image);
                    moveCard(user, _oLocation, _oLocation_html, _mLocation, _mLocation_html, i, targetIndex, true);
                } else {
                    if (oLocation.cards[i].type === 'pokemon' && movingCard.image.damageCounter){
                        addDamageCounter(user, _oLocation, _oLocation_html, i, true);
                        image.damageCounter.textContent = movingCard.image.damageCounter.textContent;
                    };
                    if (user === 'self'){
                        attachedCardPopup_html.style.display = 'block';
                    } else {
                        oppAttachedCardPopup_html.style.display = 'block';
                    };
                    moveCard(user, _oLocation, _oLocation_html, 'attachedCardPopup', 'attachedCardPopup_html', i, false, true);
                };
                i--;
            };
        };
    };
    // deal with damage counters
    if (movingCard.image.damageCounter){
        //redefine index of movingCard because its location could have moved due to attached cards.
        const index = mLocation.cards.findIndex(card => card === movingCard);

        if (attachedLocations.includes(_mLocation_html)){
            addDamageCounter(user, _mLocation, _mLocation_html, index, true);
        } else {
            movingCard.image.damageCounter.textContent = '0';
            movingCard.image.damageCounter.handleRemove();
        };
    };
    if (movingCard.image.abilityCounter){
        //redefine index of movingCard because its location could have moved due to attached cards.
        const index = mLocation.cards.findIndex(card => card === movingCard);

        if (attachedLocations.includes(_mLocation_html)){
            addAbilityCounter(user, _mLocation, _mLocation_html, index, true);
        } else {
            movingCard.image.abilityCounter.handleRemove();
        };
    };

    if (movingCard.image.specialCondition && !['active_html'].includes(_mLocation_html)){
        movingCard.image.specialCondition.textContent = '0';
        movingCard.image.specialCondition.handleRemove();
    };
    //update damage counter locations
    if (attachedLocations.includes(_oLocation_html)){
        for (let i = 0; i < oLocation.cards.length; i++){
            const image = oLocation.cards[i].image;
            if (image.damageCounter){
                addDamageCounter(user, _oLocation, _oLocation_html, i, true);
            };
            if (image.specialCondition){
                addSpecialCondition(user, _oLocation, _oLocation_html, i, true);
            };
            if (image.abilityCounter){
                addAbilityCounter(user, _oLocation, _oLocation_html, i, true);
            };
        };
    };
    if (boardLocations.includes(_mLocation_html)){
        for (let i = 0; i < mLocation.cards.length; i++){
            const image = mLocation.cards[i].image;
            if (image.damageCounter){
                addDamageCounter(user, _mLocation, _mLocation_html, i, true);
            };
            if (image.specialCondition){
                addSpecialCondition(user, _mLocation, _mLocation_html, i, true);
            };
            if (image.abilityCounter){
                addAbilityCounter(user, _mLocation, _mLocation_html, i, true);
            };
        };
    };

    updateCount();
    hideIfEmpty(user, _oLocation_html);

    if (!p1[0] && !received){
        const oUser = user === 'self' ? 'opp' : 'self';
        const moveCardData = {
            roomId : roomId,
            user : oUser,
            oLocation : _oLocation,
            oLocation_html : _oLocation_html,
            mLocation : _mLocation,
            mLocation_html : _mLocation_html,
            index: index,
            targetIndex: targetIndex,
            received: true
        };
        // const appendMessageData = {
        //     roomId,
        //     user : POV.user,
        //     message: message,
        //     type: 'announcement'
        // };
        socket.emit('moveCard', moveCardData);
        // socket.emit('appendMessage', appendMessageData);
    };
}