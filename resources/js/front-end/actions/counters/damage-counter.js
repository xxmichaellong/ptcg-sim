import { stringToVariable } from '../../setup/containers/string-to-variable.js';
import { sCard, socket, selfContainersDocument, oppContainersDocument, p1, roomId, POV } from '../../front-end.js';

export const addDamageCounter = (user, location, container, index, received = false) => {

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
            damageCounter.className = POV.user === 'self' ? 'self-circle' : 'opp-circle';
        } else {
            damageCounter = oppContainersDocument.createElement('div');
            damageCounter.className = POV.user === 'self' ? 'opp-circle' : 'self-circle';
        };
        damageCounter.contentEditable = 'true';
        damageCounter.textContent = '10';
    };
   
    damageCounter.style.display = 'inline-block';
    damageCounter.style.left = `${targetRect.left - containerRect.left + targetRect.width/1.5}px`;
    damageCounter.style.top = `${targetRect.top - containerRect.top + targetRect.height/4}px`;
    container.appendChild(damageCounter);

    if (targetCard.image.parentElement.classList.contains('fullView')){
        damageCounter.style.display = 'none';
    };
    //adjust size of the circle based on card size
    damageCounter.style.width = `${targetRect.width/3}px`;
    damageCounter.style.height = `${targetRect.width/3}px`;
    damageCounter.style.lineHeight = `${targetRect.width/3}px`;
    damageCounter.style.fontSize = `${targetRect.width/6}px`;
    damageCounter.style.zIndex = '1';
    
    const handleInput = () => {
        if (!p1[0]){
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId : roomId,
                user : oUser,
                location: _location,
                index: index,
                textContent: damageCounter.textContent
            };
            socket.emit('updateDamageCounter', data);
        };
    }

    const handleResize = () => {
        addDamageCounter(user, _location, _container, index, true);
    };

    const handleRemove = (fromBlurEvent = false) => {
        if (damageCounter.textContent.trim() === '' || damageCounter.textContent <= 0){
            targetCard.image.damageCounter.removeEventListener('input', targetCard.image.damageCounter.handleInput);
            targetCard.image.damageCounter.handleInput = null;
            targetCard.image.damageCounter.removeEventListener('blur', targetCard.image.damageCounter.handleRemoveWrapper);
            targetCard.image.damageCounter.handleRemove = null;
            window.removeEventListener('resize', targetCard.image.damageCounter.handleResize);
            targetCard.image.damageCounter.remove();
            targetCard.image.damageCounter = null;
        
            if (fromBlurEvent && !p1[0]){
                const oUser = user === 'self' ? 'opp' : 'self';
                const data = {
                    roomId : roomId,
                    user : oUser,
                    location: _location,
                    index: index,
                };
                socket.emit('removeDamageCounter', data);
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

    if (!p1[0] && !received){
        const data = {
            roomId : roomId,
            user : sCard.oUser,
            location : _location,
            container: _container,
            index: index,
            received: true
        };
        socket.emit('addDamageCounter', data);
    };
}

