import { systemState, socket } from "../../front-end.js";
import { stringToVariable } from "../../setup/zones/zone-string-to-variable.js";
import { addAbilityCounter } from "../counters/ability-counter.js";
import { addDamageCounter } from "../counters/damage-counter.js";
import { addSpecialCondition } from "../counters/special-condition.js";

export const rotateCard = (user, zoneArrayString, zoneElementString, index, single = false, emit = true) => {
    const zoneArray = stringToVariable(user, zoneArrayString);
    const rotatingImage = zoneArray[index].image;
    const currentRotation = parseInt(rotatingImage.style.transform.replace(/[^0-9-]/g, '')) || 0;
    const newRotation = (currentRotation + 90) % 360;
    rotatingImage.style.transform = `rotate(${newRotation}deg)`;

    if (['benchArray'].includes(zoneArrayString)){
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
            rotatingImage.PokémonBreak = true;
        } else {
            rotatingImage.style.transform = 'rotate(0deg)';
            rotatingImage.PokémonBreak = false;
        };
    };
    //update any damagecounters/specialconditions/abilitycounters
    for (let i = 0; i < zoneArray.length; i++){
        const image = zoneArray[i].image;
        if (image.damageCounter){
            addDamageCounter(user, zoneArrayString, zoneElementString, i, false);
        };
        if (image.specialCondition){
            addSpecialCondition(user, zoneArrayString, zoneElementString, i, false);
        };
        if (image.abilityCounter){
            addAbilityCounter(user, zoneArrayString, zoneElementString, i, false);
        };
    };
    if (systemState.isTwoPlayer && emit){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId : systemState.roomId,
            user : oUser,
            zoneArrayString : zoneArrayString,
            zoneElementString : zoneElementString,
            index: index,
            single: single,
            emit: false
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
    if (targetImage.PokémonBreak){
        image.style.transform = `rotate(${currentRotation - 90}deg)`
    } else {
        image.style.transform = `rotate(${currentRotation}deg)`
    };
}