import { socket, systemState } from '../../front-end.js';

export const processAction = (user, emit, action, parameters) => {
  const notSpectator = !(
    document.getElementById('spectatorModeCheckbox').checked &&
    systemState.isTwoPlayer
  );
  if (!systemState.isUndoInProgress && emit && notSpectator) {
    if (!systemState.isTwoPlayer || user === 'self') {
      const data = {
        user: user,
        emit: emit,
        action: action,
        parameters: parameters,
      };
      if (user === 'self') {
        systemState.selfCounter++;
        systemState.selfActionData.push(data);
      } else {
        // in 1p, we want to log oppAction data and counter so undo button works. in 2p, we do not need to do this because we directly request the undo action, and then
        // their action data takes care of it (and they push the action back to us if our request is successful)
        systemState.oppCounter++;
        systemState.oppActionData.push(data);
      }
    }
    if (user === 'self' && systemState.isTwoPlayer) {
      //log the move if it's 1 player, or if it's yourself
      const data = {
        action: action,
        counter: systemState.selfCounter,
        roomId: systemState.roomId,
        parameters: parameters,
      };
      socket.emit('pushAction', data);
    } else if (systemState.isTwoPlayer) {
      //if it's two player and you're moving an opponent's card, request the action before implementing
      const data = {
        action: action,
        counter: systemState.oppCounter,
        roomId: systemState.roomId,
        parameters: parameters,
      };
      socket.emit('requestAction', data);
    }

    if (!systemState.isTwoPlayer || user === 'self') {
      //for storing spectator data (note we edited the parameter metric here to reverse the initatior change)
      if (parameters[0]) {
        if (parameters[0] === 'self') {
          parameters[0] = 'opp';
        } else if (parameters[0] === 'opp') {
          parameters[0] = 'self';
        }
      }
      const data = {
        user: user,
        emit: emit,
        action: action,
        parameters: parameters,
      };
      // systemState.spectatorActionData.push(data);
      if (action !== 'exchangeData' && action !== 'loadDeckData') {
        systemState.exportActionData.push(data);
      }
    }
  }
};
