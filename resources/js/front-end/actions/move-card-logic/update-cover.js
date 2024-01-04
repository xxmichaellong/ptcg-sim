import { deckCoverElement, discardCoverElement, lostZoneCoverElement, oppDeckCoverElement, oppDiscardCoverElement, oppLostZoneCoverElement, systemState } from "../../front-end.js";
import { Cover } from "../../setup/deck-constructor/cover.js";
import { stringToVariable } from "../../setup/zones/zone-string-to-variable.js";
import { getZoneCount } from "../general/count.js";

export const updateOriginCover = (user, oZoneArrayString, index) => {
    const oZoneArray = stringToVariable(user, oZoneArrayString);
    const oZoneCount = getZoneCount(oZoneArray);
     // check if we need to replace the cover of the lostzone/discard (if the index of movingcard is equal to the length of the array) 
    // ** note, the card has already been removed from oZoneArray in line 27, which is why we use oZoneArray.length and not oZoneArray.length - 1 **
    if (['lostZoneArray', 'discardArray'].includes(oZoneArrayString) && index === oZoneCount){
        let coverElement;
        if (user === 'self') {
            coverElement = oZoneArrayString === 'discardArray' ? discardCoverElement : lostZoneCoverElement;
        } else {
            coverElement = oZoneArrayString === 'discardArray' ? oppDiscardCoverElement : oppLostZoneCoverElement;
        };
        // remove existing cover image
        coverElement.removeChild(coverElement.firstElementChild);
        // if there are still cards in array, append new cover image 
        if (oZoneCount > 0){
            let cover;
            const imageURL = oZoneArray[oZoneCount - 1].image.src;
            const name = oZoneArrayString === 'discardArray' ? 'discardCoverElement' : 'lostZoneCoverElement';
            cover = new Cover(user, name, imageURL);
            coverElement.appendChild(cover.image);
        };
    // check if we need to delete the cover of the deck if the movingCard was the last card in deck, i.e., there's no cards left in deck
    } else if (['deckArray'].includes(oZoneArrayString) && oZoneCount === 0){
        const coverElement = user === 'self' ? deckCoverElement : oppDeckCoverElement;
        coverElement.removeChild(coverElement.firstElementChild);
    };
}

export const updateDestinationCover = (user, dZoneArrayString, imageURL) => {
    const dZoneArray = stringToVariable(user, dZoneArrayString);
    const dZoneCount = getZoneCount(dZoneArray);
    //update discard/lostzone cover
    if (['lostZoneArray', 'discardArray'].includes(dZoneArrayString)){
        let cover;
        let coverElement;
        if (user === 'self') {
            coverElement = dZoneArrayString === 'discardArray' ? discardCoverElement : lostZoneCoverElement;
        } else {
            coverElement = dZoneArrayString === 'discardArray' ? oppDiscardCoverElement : oppLostZoneCoverElement;
        };
        const name = dZoneArrayString === 'discardArray' ? 'discardCoverElement' : 'lostZoneCoverElement';
        cover = new Cover(user, name, imageURL);
    
        if (coverElement.firstElementChild){
            coverElement.removeChild(coverElement.firstElementChild);
        };
        coverElement.appendChild(cover.image);
    //add deck cover if it's the only card in deck
    } else if (['deckArray'].includes(dZoneArrayString) && dZoneCount === 1){
        const coverElement = user === 'self' ? deckCoverElement : oppDeckCoverElement;
        if (coverElement.firstElementChild){
            coverElement.removeChild(coverElement.firstElementChild);
        };
        imageURL = systemState.cardBackSrc;
        const cover = new Cover(user, 'deckCoverElement', imageURL);
        coverElement.appendChild(cover.image);
    };
}