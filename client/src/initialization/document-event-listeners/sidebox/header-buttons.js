import { reset } from '../../../actions/general/reset.js';
import { socket, systemState } from '../../../front-end.js';
import { cleanActionData } from '../../../setup/general/clean-action-data.js';
import { processAction } from '../../../setup/general/process-action.js';
import { show } from '../../../setup/home-header/header-toggle.js';
import { handleSpectatorButtons } from '../../../setup/spectator/handle-spectator-buttons.js';
import { removeSyncIntervals } from '../../socket-event-listeners/socket-event-listeners.js';

export const initializeHeaderButtons = () => {
  const connectedRoom = document.getElementById('connectedRoom');
  const lobby = document.getElementById('lobby');
  const p2Chatbox = document.getElementById('p2Chatbox');
  const p2ExplanationBox = document.getElementById('p2ExplanationBox');

  const p1Button = document.getElementById('p1Button');
  p1Button.addEventListener('click', () => {
    if (!systemState.isTwoPlayer) {
      show('p1Box', p1Button);
    } else if (
      window.confirm(
        'Are you sure you want to leave the room? Battle log will be erased.'
      )
    ) {
      const isSpectator =
        systemState.isTwoPlayer &&
        document.getElementById('spectatorModeCheckbox').checked;
      const username = isSpectator
        ? systemState.spectatorUsername
        : systemState.p2SelfUsername;
      const data = {
        roomId: systemState.roomId,
        username: username,
        isSpectator:
          document.getElementById('spectatorModeCheckbox').checked &&
          systemState.isTwoPlayer,
      };
      socket.emit('leaveRoom', data);
      p2ExplanationBox.style.display = 'block';
      lobby.style.display = 'block';
      connectedRoom.style.display = 'none';
      document.getElementById('importState').style.display = 'inline';
      document.getElementById('flipBoardButton').style.display = 'inline-block';
      systemState.isTwoPlayer = false;
      systemState.roomId = '';
      cleanActionData('self');
      cleanActionData('opp');
      reset('opp', true, true, false, true);

      // repopulate self deck with the correct current decklist
      systemState.selfDeckData = '';
      let decklistTable = document.getElementById('selfCurrentDecklistTable');
      if (decklistTable) {
        let rows = decklistTable.rows;
        let deckData = [];
        for (let i = 1; i < rows.length; i++) {
          let cells = rows[i].cells;

          let quantity = cells[0].innerText;
          let name = cells[1].innerText;
          let type = cells[2].querySelector('select').value;
          let url = cells[3].innerText;

          let cardData = [quantity, name, type, url];
          deckData.push(cardData);
        }
        if (deckData.length > 0) {
          systemState.selfDeckData = deckData;
        }
      }

      reset('self', true, true, false, true);
      p2Chatbox.innerHTML = '';
      systemState.coachingMode = false;
      show('p1Box', p1Button);
      handleSpectatorButtons();
      removeSyncIntervals();
      systemState.spectatorId = '';
      if (systemState.selfDeckData) {
        processAction('self', true, 'loadDeckData', [systemState.selfDeckData]);
      }
      if (systemState.p1OppDeckData) {
        processAction('opp', true, 'loadDeckData', [systemState.p1OppDeckData]);
      }
    }
  });

  const p2Button = document.getElementById('p2Button');
  p2Button.addEventListener('click', () => {
    show('p2Box', p2Button);
  });

  const deckImportButton = document.getElementById('deckImportButton');
  deckImportButton.addEventListener('click', () => {
    show('deckImport', deckImportButton);
  });

  const settingsButton = document.getElementById('settingsButton');
  settingsButton.addEventListener('click', () => {
    show('settings', settingsButton);
  });
};
