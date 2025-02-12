import { reset } from '../../actions/general/reset.js';
import { socket, systemState } from '../../front-end.js';
import { appendMessage } from '../chatbox/append-message.js';
import { acceptAction } from '../general/accept-action.js';
import { cleanActionData } from '../general/clean-action-data.js';
import { handleSpectatorButtons } from './handle-spectator-buttons.js';

let socketId = '';
let spectatorTimerId;

export const spectatorJoin = () => {
  const connectedRoom = document.getElementById('connectedRoom');
  const lobby = document.getElementById('lobby');
  const roomHeaderText = document.getElementById('roomHeaderText');
  const chatbox = document.getElementById('chatbox');
  const p2ExplanationBox = document.getElementById('p2ExplanationBox');
  document.getElementById('importState').style.display = 'none';
  roomHeaderText.textContent = 'id: ' + systemState.roomId;
  chatbox.innerHTML = '';
  connectedRoom.style.display = 'flex';
  lobby.style.display = 'none';
  p2ExplanationBox.style.display = 'none';
  systemState.isTwoPlayer = true;
  cleanActionData('self');
  cleanActionData('opp');
  reset('self', true, false, false, false);
  reset('opp', true, false, false, false);

  handleSpectatorButtons();

  systemState.spectatorUsername = systemState.p2SelfUsername;

  appendMessage(
    '',
    systemState.spectatorUsername + ' joined',
    'announcement',
    true
  );

  socketId = '';
  systemState.spectatorCounter = 0;
};

socket.on('spectatorActionData', (data) => {
  const isSpectator =
    document.getElementById('spectatorModeCheckbox').checked &&
    systemState.isTwoPlayer;

  if (isSpectator) {
    if (socketId === '') {
      appendMessage(
        '',
        'Loading spectator view...',
        'loading-spectator',
        false
      );
      socketId = data.socketId;
    }
    if (socketId === data.socketId) {
      systemState.spectatorId = socketId;
      if (spectatorTimerId) {
        clearTimeout(spectatorTimerId);
      }
      const timerId = setTimeout(() => {
        socketId = '';
        systemState.spectatorCounter = 0;
      }, 5000);
      spectatorTimerId = timerId;

      systemState.p2SelfUsername = data.selfUsername;
      systemState.selfDeckData = data.selfDeckData;
      systemState.p2OppUsername = data.oppUsername;
      systemState.p2OppDeckData = data.oppDeckData;
      const actionData = data.spectatorActionData;
      const missingActions = actionData.slice(systemState.spectatorCounter);
      systemState.spectatorCounter = actionData.length;

      missingActions.forEach((data) => {
        acceptAction(data.user, data.action, data.parameters);
      });
    }
  }
});
