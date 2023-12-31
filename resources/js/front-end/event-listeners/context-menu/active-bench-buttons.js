import { addAbilityCounter } from "../../actions/counters/ability-counter.js";
import { addDamageCounter } from "../../actions/counters/damage-counter.js";
import { addSpecialCondition } from "../../actions/counters/special-condition.js";
import { changeType } from "../../actions/general/change-type.js";
import { moveCard } from "../../actions/general/move-card.js";
import { damageCounterButton, sCard, specialConditionButton, abilityCounterButton, POV, changeToEnergyButton, changeToPokémonButton, changeToToolButton } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { variableToString } from "../../setup/containers/string-to-variable.js";
import { determineUsername } from "../../setup/general/determine-username.js";


damageCounterButton.addEventListener('click', () => {
    addDamageCounter(sCard.user, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index);
});

specialConditionButton.addEventListener('click', () => {
    addSpecialCondition(sCard.user, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index)
});

abilityCounterButton.addEventListener('click', () => {
    if (sCard.card.image.abilityCounter){
        sCard.card.image.abilityCounter.handleRemove();
    } else {
        addAbilityCounter(sCard.user, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index);
        appendMessage(POV.user, determineUsername(POV.user) + ' used ' + sCard.card.name + "'s ability", 'player');
    };
});

changeToEnergyButton.addEventListener('click', () => {
    changeType(sCard.user, sCard.locationAsString, sCard.index, 'Energy');
    appendMessage(sCard.user, determineUsername(sCard.user) + ' changed ' + sCard.card.name + ' into an energy', 'player');
    moveCard(sCard.user, sCard.locationAsString, sCard.containerId, 'board', 'board_html', sCard.index);
});
changeToPokémonButton.addEventListener('click', () => {
    changeType(sCard.user, sCard.locationAsString, sCard.index, 'Pokémon');
    appendMessage(sCard.user, determineUsername(sCard.user) + ' changed ' + sCard.card.name + ' into a Pokémon', 'player');
    moveCard(sCard.user, sCard.locationAsString, sCard.containerId, 'board', 'board_html', sCard.index);
});
changeToToolButton.addEventListener('click', () => {
    changeType(sCard.user, sCard.locationAsString, sCard.index, 'Trainer');
    appendMessage(sCard.user, determineUsername(sCard.user) + ' changed ' + sCard.card.name + ' into a tool', 'player');
    moveCard(sCard.user, sCard.locationAsString, sCard.containerId, 'board', 'board_html', sCard.index);
});

