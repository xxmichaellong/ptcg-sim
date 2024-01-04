import { stringToVariable } from '../../setup/zones/zone-string-to-variable.js';
import { selfContainersDocument, oppContainersDocument, socket, systemState, sCard } from '../../front-end.js';

export const addSpecialCondition = (user, zoneArrayString, zoneElementString, index, emit = true) => {

    const zoneArray = stringToVariable(user, zoneArrayString);
    const zoneElement = stringToVariable(user, zoneElementString);

    const targetCard = zoneArray[index];
    const targetRect = targetCard.image.getBoundingClientRect();
    const zoneElementRect = zoneElement.getBoundingClientRect();

    let specialCondition = targetCard.image.specialCondition;
    //clean up existing event listeners
    if (specialCondition){
        specialCondition.removeEventListener('input', specialCondition.handleColour);
        specialCondition.removeEventListener('input', specialCondition.handleInput);
        specialCondition.handleInput = null;
        specialCondition.removeEventListener('blur', specialCondition.handleRemoveWrapper);
        specialCondition.handleRemove = null;
        window.removeEventListener('resize', specialCondition.handleResize);
    } else {
        if (user === 'self'){
            specialCondition = selfContainersDocument.createElement('div');
            specialCondition.className = systemState.pov.user === 'self' ? 'self-circle' : 'opp-circle';
        } else {
            specialCondition = oppContainersDocument.createElement('div');
            specialCondition.className = systemState.pov.user === 'self' ? 'opp-circle' : 'self-circle';
        };
        specialCondition.contentEditable = 'true';
        specialCondition.textContent = 'P';
        specialCondition.style.backgroundColor = 'green';
        specialCondition.style.color = 'white';
    };
   
    specialCondition.style.display = 'inline-block';
    specialCondition.style.left = `${targetRect.left - zoneElementRect.left}px`;
    specialCondition.style.top = `${targetRect.top - zoneElementRect.top + targetRect.height/4}px`;
    zoneElement.appendChild(specialCondition);

    if (targetCard.image.parentElement.classList.contains('full-view')){
        specialCondition.style.display = 'none';
    };

    specialCondition.style.width = `${targetRect.width/3}px`;
    specialCondition.style.height = `${targetRect.width/3}px`;
    specialCondition.style.lineHeight = `${targetRect.width/3}px`;
    specialCondition.style.fontSize = `${targetRect.width/4}px`;
    specialCondition.style.zIndex = '1';

    const handleColour = () => {
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
        }
    }

    const handleInput = () => {
        if (systemState.isTwoPlayer){
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId : systemState.roomId,
                user : oUser,
                zoneArrayString: zoneArrayString,
                index: index,
                textContent: specialCondition.textContent
            };
            socket.emit('updateSpecialCondition', data);
        };
    }

    const handleResize = () => {
        addSpecialCondition(user, zoneArrayString, zoneElementString, index, false);
    };

    const handleRemove = (fromBlurEvent = false) => {
        if (specialCondition.textContent.trim() === '' || specialCondition.textContent === '0'){
            targetCard.image.specialCondition.removeEventListener('input', targetCard.image.specialCondition.handleColour);
            targetCard.image.specialCondition.removeEventListener('input', targetCard.image.specialCondition.handleInput);
            targetCard.image.specialCondition.handleInput = null;
            targetCard.image.specialCondition.removeEventListener('blur', targetCard.image.specialCondition.handleRemoveWrapper);
            targetCard.image.specialCondition.handleRemove = null;
            window.removeEventListener('resize', targetCard.image.specialCondition.handleResize);
            targetCard.image.specialCondition.remove();
            targetCard.image.specialCondition = null;
        
            if (fromBlurEvent){
                const oUser = user === 'self' ? 'opp' : 'self';
                const data = {
                    roomId : systemState.roomId,
                    user : oUser,
                    zoneArrayString: zoneArrayString,
                    index: index,
                };
                socket.emit('removeSpecialCondition', data);            
            };
        };
    }
    specialCondition.addEventListener('input', handleColour);
    specialCondition.handleColour = handleColour;

    specialCondition.addEventListener('input', handleInput);
    specialCondition.handleInput = handleInput;

    specialCondition.handleRemoveWrapper = () => handleRemove(true);
    specialCondition.addEventListener('blur', specialCondition.handleRemoveWrapper);
    specialCondition.handleRemove = handleRemove;

    specialCondition.handleResize = handleResize;
    window.addEventListener('resize', handleResize);

    //save the specialCondition on the card
    targetCard.image.specialCondition = specialCondition;

    if (systemState.isTwoPlayer && emit){
        const data = {
            roomId : systemState.roomId,
            user : sCard.oUser,
            zoneArrayString : zoneArrayString,
            zoneElementString: zoneElementString,
            index: index,
            emit: false
        };
        socket.emit('addSpecialCondition', data);
    };
}

