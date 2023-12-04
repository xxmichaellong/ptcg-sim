import { selfContainersDocument } from "../setup/self-initialization.js";
import { oppContainersDocument } from "../setup/opp-initialization.js";
import { stringToVariable } from "../setup/string-to-variable.js";
import { socket } from "../setup/socket.js";
import { roomId } from "../start-page/generate-id.js";

export function addSpecialCondition (user, location, container, index){

    const _location = location;
    const _container = container;

    location = stringToVariable(user, location);
    container = stringToVariable(user, container);

    //identify target image and container locations
    const targetCard = location.cards[index];
    const targetRect = targetCard.image.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

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
            specialCondition.style.fontSize = '15px';
        } else {
            specialCondition = oppContainersDocument.createElement('div');
            specialCondition.style.fontSize = '10px';
        };
        specialCondition.className = 'circle';
        specialCondition.contentEditable = 'true';
        specialCondition.textContent = 'P';
        specialCondition.style.backgroundColor = 'green';
        specialCondition.style.color = 'white';
    };
   
    specialCondition.style.display = 'inline-block';
    specialCondition.style.left = `${targetRect.left - containerRect.left}px`;
    specialCondition.style.top = `${targetRect.height/4}px`;
    container.appendChild(specialCondition, targetCard.image);
    //adjust size of the circle based on card size
    specialCondition.style.width = `${targetRect.width/3}px`;
    specialCondition.style.lineHeight = `${targetRect.width/3}px`;


    const handleColour = () => {
        let text = specialCondition.textContent.toUpperCase();
        switch (text) {
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
            default:
                specialCondition.style.backgroundColor = 'white';
                specialCondition.style.color = 'black';
                break;
        }
    }

    //functions for event listeners (updating text and removing specialCondition)
    const handleInput = () => {
        // Send an update over the socket with the new text content
        if (user === 'self'){
            socket.emit('updateSpecialCondition', roomId, 'opp', _location, index, specialCondition.textContent);
        } else {
            socket.emit('updateSpecialCondition', roomId, 'self', _location, index, specialCondition.textContent);
        };
    }

    const handleResize = () => {
        addSpecialCondition(user, _location, _container, index)
    };

    const handleRemove = (fromBlurEvent = false) => {
        if (specialCondition.textContent.trim() === '' || specialCondition.textContent === '0'){
            let user;
            if (selfContainersDocument.body.contains(specialCondition)){
                user = 'opp';
            } else {
                user = 'self';
            };
            targetCard.image.specialCondition.removeEventListener('input', targetCard.image.specialCondition.handleColour);
            targetCard.image.specialCondition.removeEventListener('input', targetCard.image.specialCondition.handleInput);
            targetCard.image.specialCondition.handleInput = null;
            targetCard.image.specialCondition.removeEventListener('blur', targetCard.image.specialCondition.handleRemoveWrapper);
            targetCard.image.specialCondition.handleRemove = null;
            window.removeEventListener('resize', targetCard.image.specialCondition.handleResize);

            targetCard.image.specialCondition.remove();
            targetCard.image.specialCondition = null;
        
            if (fromBlurEvent){
                socket.emit('removeSpecialCondition', roomId, user, _location, index);
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
}

