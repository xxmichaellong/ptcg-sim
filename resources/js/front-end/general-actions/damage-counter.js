import { selfContainersDocument } from "../setup/self-initialization.js";
import { oppContainersDocument } from "../setup/opp-initialization.js";
import { stringToVariable } from "../setup/string-to-variable.js";
import { socket } from "../setup/socket.js";
import { roomId } from "../start-page/generate-id.js";

export function addDamageCounter (user, location, container, index){

    const _location = location;
    const _container = container;

    location = stringToVariable(user, location);
    container = stringToVariable(user, container);

    //identify target image and container locations
    const targetCard = location.cards[index];
    const targetRect = targetCard.image.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    let damageCounter = targetCard.image.damageCounter;
    //clean up existing event listeners
    if (damageCounter){
        damageCounter.removeEventListener('input', damageCounter.handleInput);
        damageCounter.handleInput = null;
        damageCounter.removeEventListener('blur', damageCounter.handleRemoveWrapper);
        damageCounter.handleRemove = null;
        window.removeEventListener('resize', damageCounter.handleResize);
    } else {
        if (user === 'self'){
            damageCounter = selfContainersDocument.createElement('div');
            damageCounter.style.fontSize = '15px';
        } else {
            damageCounter = oppContainersDocument.createElement('div');
            damageCounter.style.fontSize = '10px';
        };
        damageCounter.className = 'circle';
        damageCounter.contentEditable = 'true';
        damageCounter.textContent = '10';
    };
   
    damageCounter.style.display = 'inline-block';
    damageCounter.style.left = `${targetRect.left - containerRect.left + targetRect.width/1.5}px`;
    if (targetCard.image.parentElement.classList.contains('fullView')){
        damageCounter.style.top = `${targetRect.top - containerRect.top + targetRect.height/3}px`;
    } else {
        damageCounter.style.top = `${targetRect.height/3}px`;
    };
    container.appendChild(damageCounter);
    //adjust size of the circle based on card size
    damageCounter.style.width = `${targetRect.width/4}px`;
    damageCounter.style.height = `${targetRect.width/4}px`;
    damageCounter.style.lineHeight = `${targetRect.width/4}px`;
    damageCounter.style.zIndex = '1';
    
    //functions for event listeners (updating text and removing damageCounter)
    const handleInput = () => {
        // Send an update over the socket with the new text content
        if (user === 'self'){
            socket.emit('updateDamageCounter', roomId, 'opp', _location, index, damageCounter.textContent);
        } else {
            socket.emit('updateDamageCounter', roomId, 'self', _location, index, damageCounter.textContent);
        };
    }

    const handleResize = () => {
        addDamageCounter(user, _location, _container, index)
    };

    const handleRemove = (fromBlurEvent = false) => {
        if (damageCounter.textContent.trim() === '' || damageCounter.textContent === '0'){
            let user;
            if (selfContainersDocument.body.contains(damageCounter)){
                user = 'opp';
            } else {
                user = 'self';
            };
            targetCard.image.damageCounter.removeEventListener('input', targetCard.image.damageCounter.handleInput);
            targetCard.image.damageCounter.handleInput = null;
            targetCard.image.damageCounter.removeEventListener('blur', targetCard.image.damageCounter.handleRemoveWrapper);
            targetCard.image.damageCounter.handleRemove = null;
            window.removeEventListener('resize', targetCard.image.damageCounter.handleResize);

            targetCard.image.damageCounter.remove();
            targetCard.image.damageCounter = null;
        
            if (fromBlurEvent){
                socket.emit('removeDamageCounter', roomId, user, _location, index);
            };
        };
    }

    damageCounter.addEventListener('input', handleInput);
    damageCounter.handleInput = handleInput;

    damageCounter.handleRemoveWrapper = () => handleRemove(true);
    damageCounter.addEventListener('blur', damageCounter.handleRemoveWrapper);
    damageCounter.handleRemove = handleRemove;

    damageCounter.handleResize = handleResize;
    window.addEventListener('resize', handleResize);

    //save the damageCounter on the card
    targetCard.image.damageCounter = damageCounter;
}

