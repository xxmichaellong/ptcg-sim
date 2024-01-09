import { oppContainerDocument, selfContainerDocument, socket, systemState } from '../../front-end.js';
import { getZone } from '../../setup/zones/get-zone.js';

export const addSpecialCondition = (user, zoneId, index, emit = true) => {
    const zone = getZone(user, zoneId);
    const targetCard = zone.array[index];
    const targetRect = targetCard.image.getBoundingClientRect();
    const zoneElementRect = zone.element.getBoundingClientRect();

    let specialCondition = targetCard.image.specialCondition;
    //clean up existing event listeners
    if (specialCondition){
        specialCondition.removeEventListener('input', specialCondition.handleColor);
        specialCondition.handleColor = null;
        specialCondition.removeEventListener('blur', specialCondition.handleRemoveWrapper);
        specialCondition.handleRemove = null;
        window.removeEventListener('resize', specialCondition.handleResize);
    } else {
        if (user === 'self'){
            specialCondition = selfContainerDocument.createElement('div');
            specialCondition.className = systemState.initiator === 'self' ? 'self-circle' : 'opp-circle';
        } else {
            specialCondition = oppContainerDocument.createElement('div');
            specialCondition.className = systemState.initiator === 'self' ? 'opp-circle' : 'self-circle';
        };
        specialCondition.contentEditable = 'true';
        specialCondition.textContent = 'P';
        specialCondition.style.backgroundColor = 'green';
        specialCondition.style.color = 'white';
    };
   
    specialCondition.style.display = 'inline-block';
    specialCondition.style.left = `${targetRect.left - zoneElementRect.left}px`;
    specialCondition.style.top = `${targetRect.top - zoneElementRect.top + targetRect.height/4}px`;
    zone.element.appendChild(specialCondition);

    if (targetCard.image.parentElement.classList.contains('full-view')){
        specialCondition.style.display = 'none';
    };

    specialCondition.style.width = `${targetRect.width/3}px`;
    specialCondition.style.height = `${targetRect.width/3}px`;
    specialCondition.style.lineHeight = `${targetRect.width/3}px`;
    specialCondition.style.fontSize = `${targetRect.width/4}px`;
    specialCondition.style.zIndex = '1';

    const oUser = user === 'self' ? 'opp' : 'self';

    const handleColor = (emit = true) => {
        let text = specialCondition.textContent.toUpperCase();
        switch (text){
            case 'P':
                specialCondition.style.backgroundColor = 'green';
                specialCondition.style.color = 'white';
                break;
            case 'B':
                specialCondition.style.backgroundColor = 'red';
                specialCondition.style.color = 'white';
                break;
            case 'A':
                specialCondition.style.backgroundColor = 'blue';
                specialCondition.style.color = 'white';
                break;
            case 'PA':
                specialCondition.style.backgroundColor = 'yellow';
                specialCondition.style.color = 'black';
                break;
            case 'C':
                specialCondition.style.backgroundColor = 'purple';
                specialCondition.style.color = 'white';
                break;
            default:
                specialCondition.style.backgroundColor = 'white';
                specialCondition.style.color = 'black';
                break;
        };
        if (systemState.isTwoPlayer && emit){
            const data = {
                roomId: systemState.roomId,
                user: oUser,
                zoneId: zoneId,
                index: index,
                textContent: specialCondition.textContent,
                emit: false,
            };
            socket.emit('updateSpecialCondition', data);
        };
    }

    const handleResize = () => {
        addSpecialCondition(user, zoneId, index, false);
    }

    const handleRemove = (fromBlurEvent = false, emit = true) => {
        if (specialCondition.textContent.trim() === '' || specialCondition.textContent === '0'){
            targetCard.image.specialCondition.removeEventListener('input', targetCard.image.specialCondition.handleColor);
            specialCondition.handleColor = null;
            targetCard.image.specialCondition.removeEventListener('blur', targetCard.image.specialCondition.handleRemoveWrapper);
            targetCard.image.specialCondition.handleRemove = null;
            window.removeEventListener('resize', targetCard.image.specialCondition.handleResize);
            targetCard.image.specialCondition.remove();
            targetCard.image.specialCondition = null;
        
            if (systemState.isTwoPlayer && fromBlurEvent && emit){
                const data = {
                    roomId: systemState.roomId,
                    user: oUser,
                    zoneId: zoneId,
                    index: index,
                };
                socket.emit('removeSpecialCondition', data);            
            };
        };
    }
    specialCondition.handleColor = handleColor;
    specialCondition.addEventListener('input', handleColor);

    specialCondition.handleRemoveWrapper = () => handleRemove(true);
    specialCondition.addEventListener('blur', specialCondition.handleRemoveWrapper);
    specialCondition.handleRemove = handleRemove;

    specialCondition.handleResize = handleResize;
    window.addEventListener('resize', handleResize);

    //save the specialCondition on the card
    targetCard.image.specialCondition = specialCondition;

    if (systemState.isTwoPlayer && emit){
        const data = {
            roomId: systemState.roomId,
            user: oUser,
            zoneId : zoneId,
            index: index,
            emit: false
        };
        socket.emit('addSpecialCondition', data);
    };
}