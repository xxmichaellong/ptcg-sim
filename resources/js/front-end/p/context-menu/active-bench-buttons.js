damageCounterButton.addEventListener('click', function(){
    addDamageCounter(sCard.user, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index)
    socket.emit('addDamageCounter', roomId, sCard.oUser, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index)
});

specialConditionButton.addEventListener('click', function(){
    addSpecialCondition(sCard.user, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index)
    socket.emit('addSpecialCondition', roomId, sCard.oUser, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index)
});