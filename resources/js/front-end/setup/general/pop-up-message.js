import { oppContainers, selfContainers } from "../../front-end.js";

export const showPopup = (message, callback) => {
    const popup = document.createElement('div');
    popup.className = 'custom-popup';

    const popupContent = document.createElement('div');
    popupContent.className = 'popup-content';
    popupContent.textContent = message;

    const okButton = document.createElement('button');
    okButton.className = 'popup-button'
    okButton.textContent = 'OK';
    okButton.addEventListener('click', () => {
        document.body.removeChild(popup);
        selfContainers.style.zIndex = 0;
        oppContainers.style.zIndex = 0;    
        if (callback) {
            callback();
        };
    });

    popupContent.appendChild(okButton);
    popup.appendChild(popupContent);

    document.body.appendChild(popup);
    selfContainers.style.zIndex = -1;
    oppContainers.style.zIndex = -1;
}
