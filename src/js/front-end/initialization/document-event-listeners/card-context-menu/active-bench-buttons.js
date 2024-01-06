import { addAbilityCounter } from "../../../actions/counters/ability-counter.js";
import { addDamageCounter } from "../../../actions/counters/damage-counter.js";
import { addSpecialCondition } from "../../../actions/counters/special-condition.js";
import { changeType } from "../../../actions/general/change-type.js";
import { moveCard } from "../../../actions/move-card-logic/move-card.js";
import { mouseClick, systemState } from "../../../front-end.js";
import { appendMessage } from "../../../setup/chatbox/messages.js";
import { determineUsername } from "../../../setup/general/determine-username.js";

export const initializeActiveAndBenchButtons = () => {
    const damageCounterButton = document.getElementById('damageCounterButton');
    damageCounterButton.addEventListener('click', () => {
        addDamageCounter(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex);
    });

    const specialConditionButton = document.getElementById('specialConditionButton');
    specialConditionButton.addEventListener('click', () => {
        addSpecialCondition(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex)
    });

    const abilityCounterButton = document.getElementById('abilityCounterButton');
    abilityCounterButton.addEventListener('click', () => {
        if (mouseClick.card.image.abilityCounter){
            mouseClick.card.image.abilityCounter.handleRemove();
        } else {
            addAbilityCounter(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex);
            appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' used ' + mouseClick.card.name + "'s ability", 'player');
        };
    });

    const changeToEnergyButton = document.getElementById('changeToEnergyButton');
    changeToEnergyButton.addEventListener('click', () => {
        changeType(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex, 'Energy');
        const cardName = mouseClick.card.image.faceDown ? 'card' : mouseClick.card.name;
        appendMessage(mouseClick.user, determineUsername(mouseClick.user) + ' changed ' + cardName + ' into an energy', 'player');
        moveCard(mouseClick.user, mouseClick.zoneId, 'board', mouseClick.cardIndex);
    });

    // const changeToPokémonButton = document.getElementById('changeToPokémonButton');
    // changeToPokémonButton.addEventListener('click', () => {
    //     changeType(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex, 'Pokémon');
    //     appendMessage(mouseClick.user, determineUsername(mouseClick.user) + ' changed ' + mouseClick.card.name + ' into a Pokémon', 'player');
    //     moveCard(mouseClick.user, mouseClick.zoneId, 'board', mouseClick.cardIndex);
    // });

    const changeToToolButton = document.getElementById('changeToToolButton');
    changeToToolButton.addEventListener('click', () => {
        changeType(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex, 'Trainer');
        const cardName = mouseClick.card.image.faceDown ? 'card' : mouseClick.card.name;
        appendMessage(mouseClick.user, determineUsername(mouseClick.user) + ' changed ' + cardName + ' into a tool', 'player');
        moveCard(mouseClick.user, mouseClick.zoneId, 'board', mouseClick.cardIndex);
    });
}