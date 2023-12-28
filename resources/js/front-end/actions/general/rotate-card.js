import { p1, roomId, socket } from "../../front-end.js";
import { stringToVariable } from "../../setup/containers/string-to-variable.js";
import { addAbilityCounter } from "../counters/ability-counter.js";
import { addDamageCounter } from "../counters/damage-counter.js";
import { addSpecialCondition } from "../counters/special-condition.js";

export const rotateCard = (user, locationAsString, containerId, index, single = false, received = false) => {
    const location = stringToVariable(user, locationAsString);
    const rotatingImage = location.cards[index].image;
    const currentRotation = parseInt(rotatingImage.style.transform.replace(/[^0-9-]/g, '')) || 0;
    const newRotation = (currentRotation + 90) % 360;
    rotatingImage.style.transform = `rotate(${newRotation}deg)`;

    if (['bench'].includes(locationAsString)){
        rotatingImage.parentElement.style.marginRight = '3%';
        rotatingImage.parentElement.style.marginLeft = '2%';
    };
    if ([0, 180].includes(newRotation)){
        rotatingImage.parentElement.style.marginRight = '1%';
        rotatingImage.parentElement.style.marginLeft = '0%';
    };
    if (!single){
        rotatingImage.parentElement.querySelectorAll('img').forEach(image => {
            if (image !== rotatingImage){
                const currentRotation = parseInt(image.style.transform.replace(/[^0-9-]/g, '')) || 0;
                const newRotation = (currentRotation + 90) % 360;
                image.style.transform = `rotate(${newRotation}deg)`;
            };
        });
    } else {
        if ([90].includes(newRotation)){
            rotatingImage.pokemonBreak = true;
        } else {
            rotatingImage.style.transform = 'rotate(0deg)';
            rotatingImage.pokemonBreak = false;
        };
    };
    //update any damagecounters/specialconditions/abilitycounters
    for (let i = 0; i < location.cards.length; i++){
        const image = location.cards[i].image;
        if (image.damageCounter){
            addDamageCounter(user, locationAsString, containerId, i, true);
        };
        if (image.specialCondition){
            addSpecialCondition(user, locationAsString, containerId, i, true);
        };
        if (image.abilityCounter){
            addAbilityCounter(user, locationAsString, containerId, i, true);
        };
    };
    if (!p1[0] && !received){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId : roomId,
            user : oUser,
            locationAsString : locationAsString,
            containerId : containerId,
            index: index,
            single: single,
            received: true
        };
        socket.emit('rotateCard', data);
    };
}

export const resetRotation = (targetImage) => {
    const currentRotation = parseInt(targetImage.style.transform.replace(/[^0-9-]/g, '')) || 0;
    if (currentRotation !==0){
        targetImage.parentElement.querySelectorAll('img').forEach(image => {
            image.style.transform = 'rotate(0deg)';
        });
    };
    targetImage.parentElement.style.marginRight = '1%';
    targetImage.parentElement.style.marginLeft = '0%';
}

export const matchRotation = (image, targetImage) => {
    const currentRotation = parseInt(targetImage.style.transform.replace(/[^0-9-]/g, '')) || 0;
    if (targetImage.pokemonBreak){
        image.style.transform = `rotate(${currentRotation - 90}deg)`
    } else {
        image.style.transform = `rotate(${currentRotation}deg)`
    };
}