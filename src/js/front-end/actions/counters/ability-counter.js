import { oppContainerDocument, selfContainerDocument, socket, systemState } from '../../front-end.js';
import { getZone } from '../../setup/zones/get-zone.js';

export const addAbilityCounter = (user, zoneId, index) => {
    //identify target image and zone
    const zone = getZone(user, zoneId);
    const targetCard = zone.array[index];
    const targetRect = targetCard.image.getBoundingClientRect();
    const zoneElementRect = zone.element.getBoundingClientRect();

    let abilityCounter = targetCard.image.abilityCounter;
    //clean up existing event listeners
    if (abilityCounter){
        abilityCounter.handleRemove = null;
        window.removeEventListener('resize', abilityCounter.handleResize);
    } else {
        if (zoneId !== 'stadium'){
            if (user === 'self'){
                abilityCounter = selfContainerDocument.createElement('div');
                abilityCounter.className = 'self-tab';
            } else {
                abilityCounter = oppContainerDocument.createElement('div');
                abilityCounter.className = 'opp-tab';
            };
        } else {
            abilityCounter = document.createElement('div');
            abilityCounter.className = 'tab';
        };
    };
   
    abilityCounter.style.display = 'inline-block';
    abilityCounter.style.left = `${targetRect.left - zoneElementRect.left}px`;
    abilityCounter.style.top = `${targetRect.height/2}px`;
    zone.element.appendChild(abilityCounter);

    if (targetCard.image.parentElement.classList.contains('full-view')){
        abilityCounter.style.display = 'none';
    };
    //adjust size of the circle based on card size
    abilityCounter.style.width = `${targetRect.width}px`;
    abilityCounter.style.height = `${targetRect.width/5}px`;
    abilityCounter.style.lineHeight = `${targetRect.width/3}px`;
    abilityCounter.style.zIndex = '1';

    const handleResize = () => {
        addAbilityCounter(user, zoneId, index);
    };

    const handleRemove = (emit = true) => {
        targetCard.image.abilityCounter.handleRemove = null;
        window.removeEventListener('resize', targetCard.image.abilityCounter.handleResize);
        targetCard.image.abilityCounter.remove();
        targetCard.image.abilityCounter = null;
    
        if (systemState.isTwoPlayer && emit){
            user = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId: systemState.roomId,
                user: user,
                zoneId: zoneId,
                index: index,
                emit: false
            };
            socket.emit('removeAbilityCounter', data);
        };
    }

    //attach functions to abilityCounter so they can accessed later to handle changes to it
    abilityCounter.handleRemove = handleRemove;
    abilityCounter.handleResize = handleResize;
    window.addEventListener('resize', handleResize);

    //save the abilityCounter on the card
    targetCard.image.abilityCounter = abilityCounter;
}

