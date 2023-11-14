import { lostzone_html, prizes_html, lostzoneDisplay_html, discard_html, discard, 
    discardDisplay_html, deck_html, deckDisplay_html, bench_html, active_html, hand_html } from "../setup/initialization.js";
import { resetImage } from "./reset-image.js";
import { updateCount } from "../setup/counts.js";
import { makeLostzoneCover } from "../card-types/lostzone-cover.js";
import { makeDiscardCover } from "../card-types/discard-cover.js";
import { closePopups } from "../setup/close-popups.js";
import { hideCard, revealCard } from "../general-actions/reveal-and-hide-button.js";
import { stringToVariable } from "../setup/string-to-variable.js";
import { oppActive_html, oppBench_html, oppDeckDisplay_html, oppDeck_html, oppDiscardDisplay_html, oppDiscard_html, oppHand_html, oppLostzoneDisplay_html, oppLostzone_html, oppPrizes_html } from "../setup/opp-initialization.js";
import { makeDeckCover } from "../card-types/deck-cover.js";

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
                cover = makeLostzoneCover(src);
            } else if (oLocation_html === discard_html){
                cover = makeDiscardCover(src);
            } else if (oLocation_html === oppLostzone_html){
                cover = makeLostzoneCover(src);
            } else if (oLocation_html === oppDiscard_html){
                cover = makeDiscardCover(src);
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
    } else if (oLocation_html === prizes_html){
        revealCard(movingCard);
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

    // first, check if image is being attached to another card
    if (targetCard 
    && [active_html, bench_html, oppActive_html, oppBench_html].includes(mLocation_html) 
    && targetCard.image.style.position === 'static' 
    && targetCard.image !== movingCard.image
    && (![active_html, bench_html, oppActive_html, oppBench_html].includes(oLocation_html) || movingCard.image.style.position === 'absolute')){
        
        const targetRect = targetCard.image.getBoundingClientRect();

        // format the card so it's attached to targetImage
        movingCard.image.style.position = 'absolute';
        movingCard.image.style.left = targetRect.left;
        movingCard.image.relative = targetCard.image;    
        movingCard.image.target = 'on';

        // increase layer of targetImage by 1
        /* if (!targetCard.image.layer){
            targetImage.layer = 0;
        }; */
        targetCard.image.layer += 1;

        const layerIncreaseFactor = 10; // 10% increase for each layer
        const zindexDecreaseFactor = -1; // -1 decrease for each layer
        
        const bottomValue = `${targetCard.image.layer * layerIncreaseFactor}%`;
        const zIndexValue = targetCard.image.layer * zindexDecreaseFactor;
    
        // make the attached card the appropriate height and attach it to image
        movingCard.image.style.bottom = bottomValue;
        movingCard.image.style.zIndex = zIndexValue;
        mLocation_html.insertBefore(movingCard.image, targetCard.image);
    } else {
        resetImage(movingCard.image);
        mLocation_html.appendChild(movingCard.image);

        if ([prizes_html, oppPrizes_html].includes(mLocation_html)){
           hideCard(movingCard);
        } else if ([lostzone_html, discard_html, oppLostzone_html, oppDiscard_html].includes(mLocation_html)){
            let display_html;
            let cover;
            if (mLocation_html === lostzone_html){
                display_html = lostzoneDisplay_html;
                cover = makeLostzoneCover(movingCard.image.src);
            } else if (mLocation_html === discard_html){
                display_html = discardDisplay_html;
                cover = makeDiscardCover(movingCard.image.src);
            } else if (mLocation_html === oppLostzone_html){
                display_html = oppLostzoneDisplay_html;
                cover = makeLostzoneCover(movingCard.image.src);
            } else if (mLocation_html === oppDiscard_html){
                display_html = oppDiscardDisplay_html;
                cover = makeDiscardCover(movingCard.image.src);
            };
            //remove any existing image
            if (display_html.firstElementChild){
                display_html.removeChild(display_html.firstElementChild);
            };
            display_html.appendChild(cover.image);
        } else if ([deck_html, oppDeck_html].includes(mLocation_html) && mLocation.cards.length === 1){
            let display_html;
            if (mLocation_html === deck_html){
                display_html = deckDisplay_html;
            } else if (mLocation_html === oppDeck_html){
                display_html = oppDeckDisplay_html;
            }
            display_html.appendChild(makeDeckCover().image);
        };
    };
   
    // deal with any attached cards!!
    if (movingCard.image.style.position === 'static'){
    
        //create a reference to the original movingCard index so it's constant within this block
        let movingCardIndex = mLocation.cards.length - 1;
        for (let i = 0; i < oLocation.cards.length; i++){
            const image = oLocation.cards[i].image;
            if (image === movingCard.image){
                break;
            } else if (image.relative === movingCard.image && [active_html, bench_html, oppActive_html, oppBench_html].includes(mLocation_html)){
                resetImage(image);
                image.style.position = 'absolute';
                moveCard(user, _oLocation, _oLocation_html, _mLocation, _mLocation_html, i, movingCardIndex);
                i--;
                //moving from empty/filled to empty
                //no change to index
                //moving from empty to empty/filled
                //no change
                //moving from filled to different filled
                //no change
                //moving from filled to same filled (last card)
                //no change
                //moving from filled to same filled (not last card)
                if(_oLocation === _mLocation && index !== movingCardIndex){
                    movingCardIndex--;
                }
            };
        };
    };

    updateCount();
    //remove popup
    closePopups();
}