import { addAbilityCounter } from "../../actions/counters/ability-counter.js";
import { addDamageCounter } from "../../actions/counters/damage-counter.js";
import { addSpecialCondition } from "../../actions/counters/special-condition.js";
import { damageCounterButton, sCard, specialConditionButton, abilityCounterButton, POV } from "../../front-end.js";
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
        appendMessage(POV.user, determineUsername(POV.user) + ' used ability', 'player');
    };
});