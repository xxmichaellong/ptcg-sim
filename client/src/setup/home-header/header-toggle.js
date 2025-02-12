import { systemState } from '../../front-end.js';

export const show = (id, button) => {
  const deckImport = document.getElementById('deckImport');
  const settings = document.getElementById('settings');
  const p1Box = document.getElementById('p1Box');
  const p2Box = document.getElementById('p2Box');
  const successText = document.getElementById('successText');
  const failedText = document.getElementById('failedText');
  const invalidText = document.getElementById('invalidText');
  const p1Button = document.getElementById('p1Button');
  const p2Button = document.getElementById('p2Button');
  const settingsButton = document.getElementById('settingsButton');
  const deckImportButton = document.getElementById('deckImportButton');
  const page = document.getElementById(id);
  const jsonReplayDiv = document.getElementById('jsonReplayDiv');
  const exitReplay = document.getElementById('exitReplay');

  deckImport.style.display = 'none';
  settings.style.display = 'none';
  p1Box.style.display = 'none';
  p2Box.style.display = 'none';
  page.style.display = 'flex';
  successText.style.display = 'none';
  failedText.style.display = 'none';
  invalidText.style.display = 'none';

  if (systemState.isReplay) {
    jsonReplayDiv.style.display = 'none';
    exitReplay.style.display = 'block';
  } else if (id === 'p1Box') {
    jsonReplayDiv.style.display = 'block';
    exitReplay.style.display = 'none';
  } else {
    jsonReplayDiv.style.display = 'none';
    exitReplay.style.display = 'none';
  }

  const buttons = [p1Button, p2Button, settingsButton, deckImportButton];

  buttons.forEach((btn) => {
    btn.classList.remove('selected-page');
    btn.classList.remove('dark-mode-2');
    btn.classList.add('not-selected-page');
  });

  button.classList.remove('not-selected-page');
  button.classList.add('selected-page');

  if (document.querySelector('.dark-mode-1')) {
    button.classList.add('dark-mode-2');
  }
};
