import { oppContainerDocument, selfContainerDocument, socket, systemState } from '../../front-end.js';
import { getZone } from '../../setup/zones/get-zone.js';

export const addDamageCounter = (user, zoneId, index, emit = true) => {
    const zone = getZone(user, zoneId);
    const targetCard = zone.array[index];
    const targetRect = targetCard.image.getBoundingClientRect();
    const zoneElementRect = zone.element.getBoundingClientRect();

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
            damageCounter = selfContainerDocument.createElement('div');
            damageCounter.className = systemState.pov.user === 'self' ? 'self-circle' : 'opp-circle';
        } else {
            damageCounter = oppContainerDocument.createElement('div');
            damageCounter.className = systemState.pov.user === 'self' ? 'opp-circle' : 'self-circle';
        };
        damageCounter.contentEditable = 'true';
        damageCounter.textContent = '10';
    };
    
    damageCounter.style.display = 'inline-block';
    damageCounter.style.left = `${targetRect.left - zoneElementRect.left + targetRect.width/1.5}px`;
    damageCounter.style.top = `${targetRect.top - zoneElementRect.top + targetRect.height/4}px`;
    zone.element.appendChild(damageCounter);

    if (targetCard.image.parentElement.classList.contains('full-view')){
        damageCounter.style.display = 'none';
    };
    //adjust size of the circle based on card size
    damageCounter.style.width = `${targetRect.width/3}px`;
    damageCounter.style.height = `${targetRect.width/3}px`;
    damageCounter.style.lineHeight = `${targetRect.width/3}px`;
    damageCounter.style.fontSize = `${targetRect.width/6}px`;
    damageCounter.style.zIndex = '1';
    
    const handleInput = () => {
        if (systemState.isTwoPlayer){
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId : systemState.roomId,
                user : oUser,
                zoneId: zoneId,
                index: index,
                textContent: damageCounter.textContent
            };
            socket.emit('updateDamageCounter', data);
        };
    }

    const handleResize = () => {
        addDamageCounter(user, zoneId, index, true);
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
        
            if (fromBlurEvent && systemState.isTwoPlayer){
                const oUser = user === 'self' ? 'opp' : 'self';
                const data = {
                    roomId : systemState.roomId,
                    user : oUser,
                    zoneId: zoneId,
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

    if (systemState.isTwoPlayer && emit){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId : systemState.roomId,
            user : oUser,
            zoneId : zoneId,
            index: index,
            emit: false
        };
        socket.emit('addDamageCounter', data);
    };
}

