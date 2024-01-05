import { stringToVariable } from '../../setup/zones/zone-string-to-variable.js';
import { sCard, socket, selfContainerDocument, oppContainerDocument, systemState } from '../../front-end.js';

export const addAbilityCounter = (user, zoneArrayString, zoneElementString, index, emit = true) => {

    const zoneArray = stringToVariable(user, zoneArrayString);
    const zoneElement = stringToVariable(user, zoneElementString);

    //identify target image and zone
    const targetCard = zoneArray[index];
    const targetRect = targetCard.image.getBoundingClientRect();
    const zoneElementRect = zoneElement.getBoundingClientRect();

    let abilityCounter = targetCard.image.abilityCounter;
    //clean up existing event listeners
    if (abilityCounter){
        abilityCounter.handleRemove = null;
        window.removeEventListener('resize', abilityCounter.handleResize);
    } else {
        if (zoneArrayString !== 'stadiumArray'){
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
    zoneElement.appendChild(abilityCounter);

    if (targetCard.image.parentElement.classList.contains('full-view')){
        abilityCounter.style.display = 'none';
    };
    //adjust size of the circle based on card size
    abilityCounter.style.width = `${targetRect.width}px`;
    abilityCounter.style.height = `${targetRect.width/5}px`;
    abilityCounter.style.lineHeight = `${targetRect.width/3}px`;
    abilityCounter.style.zIndex = '1';

    const handleResize = () => {
        addAbilityCounter(user, zoneArrayString, zoneElementString, index, false);
    };

    const handleRemove = (emit = true) => {
        targetCard.image.abilityCounter.handleRemove = null;
        window.removeEventListener('resize', targetCard.image.abilityCounter.handleResize);
        targetCard.image.abilityCounter.remove();
        targetCard.image.abilityCounter = null;
    
        if (systemState.isTwoPlayer && emit){
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId : systemState.roomId,
                user : oUser,
                zoneArrayString: zoneArrayString,
                index: index,
                emit: false
            };
            socket.emit('removeAbilityCounter', data);
        };
    }

    abilityCounter.handleRemove = handleRemove;

    abilityCounter.handleResize = handleResize;
    window.addEventListener('resize', handleResize);

    //save the abilityCounter on the card
    targetCard.image.abilityCounter = abilityCounter;

    if (systemState.isTwoPlayer && emit){
        const data = {
            roomId : systemState.roomId,
            user : sCard.oUser,
            zoneArrayString : zoneArrayString,
            zoneElementString: zoneElementString,
            index: index,
            emit: false
        };
        socket.emit('addAbilityCounter', data);
    };
}

