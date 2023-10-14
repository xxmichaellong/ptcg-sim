import { lostzone_html, lostzone, prizes_html, prizesHidden_html, lostzoneDisplay_html, discard_html, discard, discardDisplay_html, deck_html, deckDisplay_html } from "./initialization.js";
import { imageClick } from "./imageClick.js";
import { allowDrop, dragEnd, dragStart, drop } from "./drag.js";

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

    oLocation.images.forEach(image => {
        if(oLocation.images[index].relative instanceof HTMLImageElement && oLocation.images[index].relative === image.relative 
        && parseInt(image.style.bottom) > parseInt(oLocation.images[index].style.bottom)){
            image.style.bottom = (parseInt(image.style.bottom) - 10) + '%';
            image.style.zIndex = (parseInt(image.style.zIndex) + 1).toString();
        };
    });

     // reset styles
     oLocation.images[index].style.position = 'static';
     oLocation.images[index].style.bottom = '0%';
     oLocation.images[index].style.zIndex = '0';

    // remove img from origin images array and add it to new location images array
    mLocation.images.push(...oLocation.images.splice(index, 1));

    if (mLocation.images[mLocation.count-1].target === 'on'){
        mLocation.images[mLocation.count-1].relative.layer -= 1;
    };

    mLocation.images[mLocation.count-1].relative = 0;

    // append image to new container
    if (mLocation_html === prizes_html){
        const cardbackElement = document.createElement('img');
        cardbackElement.src = 'cardScans/cardback.png';
        cardbackElement.addEventListener('click', imageClick);
        cardbackElement.addEventListener('dragstart', dragStart);
        cardbackElement.addEventListener('dragend', dragEnd);
        prizesHidden_html.appendChild(cardbackElement);

        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);
        mLocation.images[mLocation.count-1].target = 'off';
    }
    else if (mLocation_html === lostzone_html){
        if (lostzoneDisplay_html.firstElementChild){
            lostzoneDisplay_html.removeChild(lostzoneDisplay_html.firstElementChild);
        }
        const coverImage = mLocation.images[mLocation.count-1].cloneNode(true);
        // remove image click function
        coverImage.removeEventListener('click', imageClick);
        coverImage.draggable = false;
        coverImage.id = "lostzoneCover"; //id to reference for dropping
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
        mLocation.images[mLocation.count-1].target = 'off';
    }
    else if (mLocation_html === discard_html){
        if (discardDisplay_html.firstElementChild){
            discardDisplay_html.removeChild(discardDisplay_html.firstElementChild);
        }
        const coverImage = mLocation.images[mLocation.count-1].cloneNode(true);
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
        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);
        mLocation.images[mLocation.count-1].target = 'off';
    }
    else if (mLocation_html === deck_html){
        if (!deckDisplay_html.firstElementChild){
            const coverImage = document.createElement('img');
            coverImage.src = 'cardScans/cardback.png';
            coverImage.draggable = false;
            coverImage.id = "deckCover"; //id to reference for dropping
            coverImage.addEventListener("dragover", allowDrop);
            coverImage.addEventListener("drop", drop);
            // Function to open the modal
            coverImage.addEventListener('click', () => {
                deck_html.style.display = 'block';
                deck.images.forEach(image => {
                    image.style.display = 'inline-block';
                });
            });
            deckDisplay_html.appendChild(coverImage);
        }
        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);
        mLocation.images[mLocation.count-1].target = 'off';
    }
    else if (targetImage && (mLocation_html === bench_html || mLocation_html === active_html) && targetImage.target === 'off'){
        const targetRect = targetImage.getBoundingClientRect();
        const draggedImage = mLocation.images[mLocation.count-1];

        draggedImage.style.position = 'absolute';
        draggedImage.style.left = targetRect.left;
       
        draggedImage.relative = targetImage;
        
        draggedImage.target = 'on';

        if (!targetImage.layer) {
            targetImage.layer = 0;
        };

        targetImage.layer += 1;

        const layerIncreaseFactor = 10; // 10% increase for each layer
        const zindexDecreaseFactor = -1; // -1 decrease for each layer
        
        const bottomValue = `${targetImage.layer * layerIncreaseFactor}%`;
        const zIndexValue = targetImage.layer * zindexDecreaseFactor;
      
        draggedImage.style.bottom = bottomValue;
        draggedImage.style.zIndex = zIndexValue;

        mLocation_html.insertBefore(draggedImage, targetImage);
    }
    else {
        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);
        mLocation.images[mLocation.count-1].target = 'off';
    };

    //remove popup
    cardPopup.style.display = "none";
}