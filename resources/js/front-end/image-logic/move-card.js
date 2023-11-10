import { lostzone_html, lostzone, prizes_html, prizesHidden_html, lostzoneDisplay_html, discard_html, discard, discardDisplay_html, deck_html, deckDisplay_html } from "./initialization.js";
import { imageClick } from "./imageClick.js";
import { allowDrop, dragEnd, dragStart, drop } from "./drag.js";
import { resetImage } from "./resetImage.js";
import { updateCount } from "./counts.js";

export function moveCard(oLocation, oLocation_html, mLocation, mLocation_html, index, targetImage){

    // remove card from origin card array to new location array
    mLocation.cards.push(...oLocation.cards.splice(index, 1));

    // remove image from origin location
    if (oLocation_html === prizes_html){
        oLocation_html.removeChild(oLocation.images[index]);
        prizesHidden_html.removeChild(prizesHidden_html.lastElementChild);
    }
    else if (oLocation_html === lostzone_html && oLocation.images[index] === oLocation.images[oLocation.images.length-1]){
        lostzoneDisplay_html.removeChild(lostzoneDisplay_html.firstElementChild)
        oLocation_html.removeChild(oLocation.images[index]);
        if (lostzone_html.querySelector('img')){
            const coverImage = oLocation.images[oLocation.count-1].cloneNode(true);
            // remove image click function
            coverImage.removeEventListener('click', imageClick);
            coverImage.draggable = false;
            // Function to open the modal
            coverImage.id = "lostzoneCover"; //id to reference for dropping
            coverImage.addEventListener("dragover", allowDrop);
            coverImage.addEventListener("drop", drop);
            coverImage.addEventListener('click', () => {
                lostzone_html.style.display = 'block';
                lostzone.images.forEach(image => {
                    image.style.display = 'inline-block';
                });   
            });
            lostzoneDisplay_html.appendChild(coverImage);
        }
    }
    else if (oLocation_html === discard_html && oLocation.images[index] === oLocation.images[oLocation.images.length-1]){
        discardDisplay_html.removeChild(discardDisplay_html.firstElementChild)
        oLocation_html.removeChild(oLocation.images[index]);
        if (discard_html.querySelector('img')){
            const coverImage = oLocation.images[oLocation.count-1].cloneNode(true);
            // remove image click function
            coverImage.removeEventListener('click', imageClick);
            coverImage.draggable = false;
            // Function to open the modal
            coverImage.id = "discardCover"; //id to reference for dropping
            coverImage.addEventListener("dragover", allowDrop);
            coverImage.addEventListener("drop", drop);
            coverImage.addEventListener('click', () => {
                discard_html.style.display = 'block';
                discard.images.forEach(image => {
                    image.style.display = 'inline-block';
                });
            });
        discardDisplay_html.appendChild(coverImage);
        }
    }
    else if (oLocation_html === deck_html && oLocation.images.length === 1){
        deckDisplay_html.removeChild(deckDisplay_html.firstElementChild)
        oLocation_html.removeChild(oLocation.images[index]);
    }
    else
        oLocation_html.removeChild(oLocation.images[index]);

    // update the zIndex and height of each card if the card was attached to the same card and located higher
    oLocation.images.forEach(image => {
        if (oLocation.images[index].relative instanceof HTMLImageElement && oLocation.images[index].relative === image.relative 
        && parseInt(image.style.bottom) > parseInt(oLocation.images[index].style.bottom)){
            image.style.bottom = (parseInt(image.style.bottom) - 10) + '%';
            image.style.zIndex = (parseInt(image.style.zIndex) + 1).toString();
        };
    });

    // remove img from origin images array and add it to new location images array
    mLocation.images.push(...oLocation.images.splice(index, 1));

    // if the image was attached to another image, decrease the level of layering on the base image
    if (mLocation.images[mLocation.count-1].target === 'on'){
        mLocation.images[mLocation.count-1].relative.layer -= 1;
    };

    // first, check if image is being attached to another card
    if (targetImage && (mLocation_html === bench_html || mLocation_html === active_html) && targetImage.style.position === 'static' 
    && targetImage !== mLocation.images[mLocation.count-1] 
    && ((oLocation_html !== bench_html && oLocation_html !== active_html) || mLocation.images[mLocation.count-1].style.position === 'absolute')){
        const targetRect = targetImage.getBoundingClientRect();
        const draggedImage = mLocation.images[mLocation.count-1];

        // format the card so it's attached to targetImage
        draggedImage.style.position = 'absolute';
        draggedImage.style.left = targetRect.left;
        draggedImage.relative = targetImage;    
        draggedImage.target = 'on';

        // increase layer of targetImage by 1
        if (!targetImage.layer) {
            targetImage.layer = 0;
        };
        targetImage.layer += 1;

        const layerIncreaseFactor = 10; // 10% increase for each layer
        const zindexDecreaseFactor = -1; // -1 decrease for each layer
        
        const bottomValue = `${targetImage.layer * layerIncreaseFactor}%`;
        const zIndexValue = targetImage.layer * zindexDecreaseFactor;
    
        // make the attached card the appropriate height and attach it to image
        draggedImage.style.bottom = bottomValue;
        draggedImage.style.zIndex = zIndexValue;
        mLocation_html.insertBefore(draggedImage, targetImage);
    }
    // now, since we know the card isn't being attached to something else, we can reset the image styles
    else if (mLocation_html === prizes_html){
        resetImage(mLocation.images[mLocation.count-1]);

        const cardbackElement = document.createElement('img');
        cardbackElement.src = 'cardScans/cardback.png';
        cardbackElement.addEventListener('click', imageClick);
        cardbackElement.addEventListener('dragstart', dragStart);
        cardbackElement.addEventListener('dragend', dragEnd);
        prizesHidden_html.appendChild(cardbackElement);

        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);
    }
    else if (mLocation_html === lostzone_html){
        resetImage(mLocation.images[mLocation.count-1]);

        if (lostzoneDisplay_html.firstElementChild){
            lostzoneDisplay_html.removeChild(lostzoneDisplay_html.firstElementChild);
        };
        const coverImage = mLocation.images[mLocation.count-1].cloneNode(true);
        // remove image click function
        coverImage.removeEventListener('click', imageClick);
        coverImage.draggable = false;
        coverImage.id = "lostzoneCover"; // id to reference for dropping
        coverImage.addEventListener("dragover", allowDrop);
        coverImage.addEventListener("drop", drop);
        // Function to open the modal
        coverImage.addEventListener('click', () => {
            lostzone_html.style.display = 'block';
            lostzone.images.forEach(image => {
                image.style.display = 'inline-block';
            });
        });
        lostzoneDisplay_html.appendChild(coverImage);
        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);
    }
    else if (mLocation_html === discard_html){
        resetImage(mLocation.images[mLocation.count-1]);

        if (discardDisplay_html.firstElementChild){
            discardDisplay_html.removeChild(discardDisplay_html.firstElementChild);
        }
        const coverImage = mLocation.images[mLocation.count-1].cloneNode(true);
        // remove image click function
        coverImage.removeEventListener('click', imageClick);
        coverImage.draggable = false;
        // Function to open the modal
        coverImage.id = "discardCover"; // id to reference for dropping
        coverImage.addEventListener("dragover", allowDrop);
        coverImage.addEventListener("drop", drop);
        coverImage.addEventListener('click', () => {
            discard_html.style.display = 'block';
            discard.images.forEach(image => {
                image.style.display = 'inline-block';
            });
        });
        discardDisplay_html.appendChild(coverImage);
        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);
    }
    else if (mLocation_html === deck_html){
        resetImage(mLocation.images[mLocation.count-1]);

        if (!deckDisplay_html.firstElementChild){
            const coverImage = document.createElement('img');
            coverImage.src = 'cardScans/cardback.png';
            coverImage.id = "deckCover"; // id to reference for dropping
            coverImage.addEventListener("dragover", allowDrop);
            coverImage.addEventListener("drop", drop);
            // Function to open the modal
            coverImage.addEventListener('click', () => {
                deck_html.style.display = 'block';
            });
            // allow card to be dragged to draw the top card of the deck
            coverImage.draggable = true; // Make image draggable
            coverImage.addEventListener('dragstart', dragStart); //Add a dragstart event listener
            coverImage.addEventListener('dragend', dragEnd);   

            deckDisplay_html.appendChild(coverImage);
        };
        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);
    }
    else {
        resetImage(mLocation.images[mLocation.count-1]);

        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);
    };

    // deal with any attached cards!!
    if (mLocation.images[mLocation.count-1].style.position === 'static'){
        const referenceImage = mLocation.images[mLocation.count-1];
        for (let i = 0; i < oLocation.images.length; i++) {
            const image = oLocation.images[i];
            
            if (image === referenceImage){
                break;
            }
            else if (image.relative === referenceImage && (mLocation_html === bench_html || mLocation_html === active_html)) {
                resetImage(image);
                image.style.position = 'absolute';
                moveCard(oLocation, oLocation_html, mLocation, mLocation_html, i, referenceImage);
                i--;
            };
        };
    };

    updateCount();
    //remove popup
    cardPopup.style.display = "none";
    pokestopPopup.style.display = "none";
    flowerSelectingPopup.style.display = "none";
    colresssExperimentPopup.style.display = "none";
}