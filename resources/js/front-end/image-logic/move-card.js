import { lostzone_html, prizes_html, lostzoneDisplay_html, discard_html, discard, 
    discardDisplay_html, deck_html, deckDisplay_html, bench_html, active_html, hand_html, stadium_html, stadium, attachedCardPopup, attachedCardPopup_html } from "../setup/initialization.js";
import { resetImage } from "./reset-image.js";
import { updateCount } from "../setup/counts.js";
import { makeLostzoneCover } from "../card-types/lostzone-cover.js";
import { makeDiscardCover } from "../card-types/discard-cover.js";
import { closePopups } from "../setup/close-popups.js";
import { hideCard, revealCard } from "../general-actions/reveal-and-hide-button.js";
import { stringToVariable } from "../setup/string-to-variable.js";
import { oppActive_html, oppAttachedCardPopup_html, oppBench_html, oppDeckDisplay_html, oppDeck_html, oppDiscardDisplay_html, oppDiscard_html, oppHand_html, oppLostzoneDisplay_html, oppLostzone_html, oppPrizes_html } from "../setup/opp-initialization.js";
import { makeDeckCover } from "../card-types/deck-cover.js";
import { socket } from "../front-end.js";
import { addDamageCounter } from "../general-actions/damage-counter.js";

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
        if (movingCard.image.relative instanceof HTMLImageElement && movingCard.image.relative === card.image.relative 
        && parseInt(card.image.style.bottom) > parseInt(movingCard.image.style.bottom)){
            card.image.style.bottom = (parseInt(card.image.style.bottom) - 10) + '%';
            card.image.style.zIndex = (parseInt(card.image.style.zIndex) + 1).toString();
        };
    });

    // if the image was attached to another image, decrease the level of layering on the base image
    if (movingCard.image.target === 'on'){
        movingCard.image.relative.layer -= 1;
    };

    //EXTREMELY STRANGE. had an issue where cards weren't properly loading in the discard/lostzone containers
    //for some reason, refreshing the source makes the image load properly every time.
    /*hideCard(movingCard);
    revealCard(movingCard);*/
    //

    // determine whether to hide/reveal card

    if ([prizes_html, oppPrizes_html, oppHand_html].includes(mLocation_html)){
        hideCard(movingCard);
     } else {
        revealCard(movingCard);
     };
    // first, check if image is being attached to another card
    if (targetCard
    && [active_html, bench_html, oppActive_html, oppBench_html].includes(mLocation_html) 
    && targetCard.image.style.position === 'static' 
    && (![active_html, bench_html, oppActive_html, oppBench_html].includes(oLocation_html) || movingCard.image.style.position === 'absolute')){
        if (movingCard.type === 'pokemon' && ![active_html, bench_html, oppActive_html, oppBench_html].includes(oLocation_html)){
            mLocation_html.insertBefore(movingCard.image, targetCard.image);
            // change targetCard type to absolute, set relative to movingCard
            targetCard.image.style.position === 'absolute';
            targetCard.image.relative = movingCard.image;
            //if damage counter exists, link the textcontent with the new pokemon card
            if (targetCard.image.damageCounter){
                addDamageCounter(user, _mLocation, _mLocation_html, mLocation.cards.length - 1);
                movingCard.image.damageCounter.textContent = targetCard.image.damageCounter.textContent;
                //remove once opponent is finished with it
                targetCard.image.damageCounter.textContent = '0';
                targetCard.image.damageCounter.handleRemove();
            };
            // set relative of all of targetCard's attached cards to movingCard
            mLocation.cards.forEach(card => { 
                if(card.image.relative === targetCard.image){
                    card.image.relative = movingCard.image;
                };
            });
            //move the cards to the new host
            let movingCardIndex = mLocation.cards.length - 1;
            for (let i = 0; i < mLocation.cards.length; i++){
                const image = mLocation.cards[i].image;
                if (image === movingCard.image){
                    break;
                } else if (image.relative === movingCard.image){
                    resetImage(image);
                    image.style.position = 'absolute';
                    moveCard(user, _mLocation, _mLocation_html, _mLocation, _mLocation_html, i, movingCardIndex);
                    movingCardIndex--;
                    i--;
                };
            };
        } else {
            // format the card so it's attached to targetImage
            movingCard.image.style.position = 'absolute';
            movingCard.image.relative = targetCard.image;    
            movingCard.image.target = 'on';

            targetCard.image.layer += 1;

            const layerIncreaseFactor = 10; // 10% increase for each layer
            const zindexDecreaseFactor = -1; // -1 decrease for each layer
            
            const bottomValue = `${targetCard.image.layer * layerIncreaseFactor}%`;
            const zIndexValue = targetCard.image.layer * zindexDecreaseFactor;
        
            // make the attached card the appropriate height and attach it to image
            movingCard.image.style.bottom = bottomValue;
            movingCard.image.style.zIndex = zIndexValue;
            mLocation_html.insertBefore(movingCard.image, targetCard.image);
        };
    } else {
        resetImage(movingCard.image);
        mLocation_html.appendChild(movingCard.image);
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
        && ![active_html, oppActive_html].includes(oLocation_html)
        && mLocation.cards[1] 
        && movingCard.image.style.position === 'static'){
            moveCard(user, 'active', 'active_html', 'bench', 'bench_html', 0);
        //remove any existing stadium and send to correct discard pile
        } else if (stadium_html === mLocation_html && mLocation.cards[1] && user === 'self'){
            if (mLocation.cards[0].image.user === 'self'){
                moveCard('self', 'stadium', 'stadium_html', 'discard', 'discard_html', 0);
                socket.emit('moveCard', 'opp', 'stadium', 'stadium_html', 'discard', 'discard_html', 0)
            } else {
                moveCard('opp', 'stadium', 'stadium_html', 'discard', 'discard_html', 0);
                socket.emit('moveCard', 'self', 'stadium', 'stadium_html', 'discard', 'discard_html', 0)
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
    if (movingCard.image.style.position === 'static' && [active_html, bench_html, oppActive_html, oppBench_html, attachedCardPopup_html, oppAttachedCardPopup_html].includes(oLocation_html)){
        //create a reference to the original movingCard index so it's constant within this block
        let movingCardIndex = mLocation.cards.length - 1;
        for (let i = 0; i < oLocation.cards.length; i++){
            const image = oLocation.cards[i].image;
            if (image === movingCard.image){
                break;
            };
            if (image.damageCounter){
                addDamageCounter(user, _oLocation, _oLocation_html, i);
            };
            if (image.relative === movingCard.image){
                resetImage(image);
                //moving to active or bench
                if ([active_html, bench_html, oppActive_html, oppBench_html].includes(mLocation_html)){
                    image.style.position = 'absolute';
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
    updateCount();
    closePopups();
}