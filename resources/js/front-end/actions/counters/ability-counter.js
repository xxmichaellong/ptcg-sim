import { stringToVariable } from '../../setup/containers/string-to-variable.js';
import { sCard, socket, selfContainersDocument, oppContainersDocument, p1, roomId, POV } from '../../front-end.js';

export const addAbilityCounter = (user, location, container, index, received = false) => {

    const _location = location;
    const _container = container;

    location = stringToVariable(user, location);
    container = stringToVariable(user, container);

    //identify target image and container locations
    const targetCard = location.cards[index];
    const targetRect = targetCard.image.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    let abilityCounter = targetCard.image.abilityCounter;
    //clean up existing event listeners
    if (abilityCounter){
        abilityCounter.handleRemove = null;
        window.removeEventListener('resize', abilityCounter.handleResize);
    } else {
        if (user === 'self'){
            abilityCounter = selfContainersDocument.createElement('div');
            abilityCounter.className = 'self-tab';
        } else {
            abilityCounter = oppContainersDocument.createElement('div');
            abilityCounter.className = 'opp-tab';
        };
    };
   
    abilityCounter.style.display = 'inline-block';
    abilityCounter.style.left = `${targetRect.left - containerRect.left}px`;
    abilityCounter.style.top = `${targetRect.height/2}px`;
    container.appendChild(abilityCounter);

    if (targetCard.image.parentElement.classList.contains('fullView')){
        abilityCounter.style.display = 'none';
    };
    //adjust size of the circle based on card size
    abilityCounter.style.width = `${targetRect.width}px`;
    abilityCounter.style.height = `${targetRect.width/5}px`;
    abilityCounter.style.lineHeight = `${targetRect.width/3}px`;
    abilityCounter.style.zIndex = '1';

    const handleResize = () => {
        addAbilityCounter(user, _location, _container, index, true);
    };

    const handleRemove = () => {
        targetCard.image.abilityCounter.handleRemove = null;
        window.removeEventListener('resize', targetCard.image.abilityCounter.handleResize);
        targetCard.image.abilityCounter.remove();
        targetCard.image.abilityCounter = null;
    
        if (!p1[0]){
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId : roomId,
                user : oUser,
                location: _location,
                index: index,
            };
            socket.emit('removeAbilityCounter', data);
        };
    }

    abilityCounter.handleRemove = handleRemove;

    abilityCounter.handleResize = handleResize;
    window.addEventListener('resize', handleResize);

    //save the abilityCounter on the card
    targetCard.image.abilityCounter = abilityCounter;

    if (!p1[0] && !received){
        const data = {
            roomId : roomId,
            user : sCard.oUser,
            location : _location,
            container: _container,
            index: index,
            received: true
        };
        socket.emit('addAbilityCounter', data);
    };
}

