import { lostzone_html, lostzone, prizes_html, prizesHidden_html, lostzoneDisplay_html, discard_html, discard, discardDisplay_html } from "./initialization.js";
import { imageClick } from "./imageClick.js";

export function moveCard(oLocation, oLocation_html, mLocation, mLocation_html, index){
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
            // Function to open the modal
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
            // Function to open the modal
            coverImage.addEventListener('click', () => {
                discard_html.style.display = 'block';
                discard.images.forEach(image => {
                    image.style.display = 'inline-block';
                });
            });
        discardDisplay_html.appendChild(coverImage);
        }
    }
    else
        oLocation_html.removeChild(oLocation.images[index]);

    // remove img from origin images array and add it to new location images array
    mLocation.images.push(...oLocation.images.splice(index, 1));

    // append image to new container
    if (mLocation_html === prizes_html){
        const cardbackElement = document.createElement('img');
        cardbackElement.src = 'cardScans/cardback.png';
        cardbackElement.addEventListener('click', imageClick);
        prizesHidden_html.appendChild(cardbackElement);

        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);
    }
    if (mLocation_html === lostzone_html){
        if (lostzoneDisplay_html.firstElementChild){
            lostzoneDisplay_html.removeChild(lostzoneDisplay_html.firstElementChild);
        }
        const coverImage = mLocation.images[mLocation.count-1].cloneNode(true);
        // remove image click function
        coverImage.removeEventListener('click', imageClick);
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
    if (mLocation_html === discard_html){
        if (discardDisplay_html.firstElementChild){
            discardDisplay_html.removeChild(discardDisplay_html.firstElementChild);
        }
        const coverImage = mLocation.images[mLocation.count-1].cloneNode(true);
        // remove image click function
        coverImage.removeEventListener('click', imageClick);
        // Function to open the modal
        coverImage.addEventListener('click', () => {
            discard_html.style.display = 'block';
            discard.images.forEach(image => {
                image.style.display = 'inline-block';
            });
        });
        discardDisplay_html.appendChild(coverImage);
        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);
    }
    else
        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);

    //remove popup
    popup.style.display = "none";
}