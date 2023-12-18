import { addAbilityCounter } from "../../actions/counters/ability-counter.js";
import { addDamageCounter } from "../../actions/counters/damage-counter.js";
import { addSpecialCondition } from "../../actions/counters/special-condition.js";
import { damageCounterButton, sCard, specialConditionButton, abilityCounterButton } from "../../front-end.js";
import { variableToString } from "../../setup/containers/string-to-variable.js";


damageCounterButton.addEventListener('click', () => {
    addDamageCounter(sCard.user, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index);
});

specialConditionButton.addEventListener('click', () => {
    addSpecialCondition(sCard.user, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index)
});

abilityCounterButton.addEventListener('click', () => {
    addAbilityCounter(sCard.user, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index)
});