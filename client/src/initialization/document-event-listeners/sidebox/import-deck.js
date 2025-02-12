import { hideOptionsContextMenu } from '../../../setup/chatbox/hide-options-context-menu.js';
import { importDecklist } from '../../../setup/deck-constructor/import.js';
import {
  getRandomDeckList,
  showDecklistsContextMenu,
} from '../../../setup/deck-constructor/sample.decklists.js';
import { show } from '../../../setup/home-header/header-toggle.js';
import { systemState } from '../../global-variables/global-variables.js';

export const initializeImport = () => {
  const altDeckImportInput = document.getElementById('altDeckImportInput');
  const failedText = document.getElementById('failedText');
  const invalidText = document.getElementById('invalidText');
  const mainDeckImportInput = document.getElementById('mainDeckImportInput');
  const successText = document.getElementById('successText');
  const loadingText = document.getElementById('loadingText');
  const updateLoadingText = () => {
    const dots = loadingText.innerHTML.match(/\./g) || [];
    const dotCount = dots.length;
    const maxDots = 3;
    const newDotCount = (dotCount + 1) % (maxDots + 1);
    const newText = 'Loading' + '.'.repeat(newDotCount);
    loadingText.innerHTML = newText;
  };
  setInterval(updateLoadingText, 500);
  const uploadFileButton = document.getElementById('uploadFileButton');
  const changeCardBackButton = document.getElementById('changeCardBackButton');
  const selfCurrentDecklistTable = document.getElementById(
    'selfCurrentDecklistTable'
  );
  const oppCurrentDecklistTable = document.getElementById(
    'oppCurrentDecklistTable'
  );
  const saveCurrentButton = document.getElementById('saveCurrentButton');

  const mainImportHeaderButton = document.getElementById(
    'mainImportHeaderButton'
  );
  mainImportHeaderButton.addEventListener('click', () => {
    if (mainImportHeaderButton.classList.contains('main-select')) {
      return;
    } else {
      mainImportHeaderButton.classList.toggle('main-select');
      altImportHeaderButton.classList.toggle('alt-select');
      uploadFileButton.classList.toggle('self-color');
      uploadFileButton.classList.toggle('opp-color');
      changeCardBackButton.classList.toggle('self-color');
      changeCardBackButton.classList.toggle('opp-color');
      saveCurrentButton.classList.toggle('self-color');
      saveCurrentButton.classList.toggle('opp-color');
      mainDeckImportInput.style.display = 'inline-block';
      altDeckImportInput.style.display = 'none';
      successText.style.display = 'none';
      failedText.style.display = 'none';
      invalidText.style.display = 'none';

      saveCurrentButton.style.display =
        selfCurrentDecklistTable.innerHTML === '' ? 'none' : 'block';
    }
  });

  const altImportHeaderButton = document.getElementById(
    'altImportHeaderButton'
  );
  altImportHeaderButton.addEventListener('click', () => {
    if (altImportHeaderButton.classList.contains('alt-select')) {
      return;
    } else {
      mainImportHeaderButton.classList.toggle('main-select');
      altImportHeaderButton.classList.toggle('alt-select');
      uploadFileButton.classList.toggle('self-color');
      uploadFileButton.classList.toggle('opp-color');
      changeCardBackButton.classList.toggle('self-color');
      changeCardBackButton.classList.toggle('opp-color');
      saveCurrentButton.classList.toggle('self-color');
      saveCurrentButton.classList.toggle('opp-color');
      altDeckImportInput.style.display = 'inline-block';
      mainDeckImportInput.style.display = 'none';
      successText.style.display = 'none';
      failedText.style.display = 'none';
      invalidText.style.display = 'none';

      saveCurrentButton.style.display =
        oppCurrentDecklistTable.innerHTML === '' ? 'none' : 'block';
    }
  });

  const importButton = document.getElementById('importButton');
  importButton.addEventListener('click', () => {
    const user = mainDeckImportInput.style.display !== 'none' ? 'self' : 'opp';
    const notSpectator = !(
      document.getElementById('spectatorModeCheckbox').checked &&
      systemState.isTwoPlayer
    );
    const notOpp2P = !(systemState.isTwoPlayer && user === 'opp');
    if (notSpectator && notOpp2P) {
      importDecklist(user);
    } else {
      invalidText.style.display = 'block';
    }
  });

  const randomButton = document.getElementById('randomButton');
  randomButton.addEventListener('click', () => {
    const input =
      mainDeckImportInput.style.display !== 'none'
        ? mainDeckImportInput
        : altDeckImportInput;
    input.value = '';
    input.value = getRandomDeckList();
  });

  const decklistsButton = document.getElementById('decklistsButton');
  decklistsButton.addEventListener('click', showDecklistsContextMenu);

  const deckBuilderButton = document.getElementById('deckBuilderButton');
  deckBuilderButton.addEventListener('click', function () {
    window.open('https://tishinator.github.io/PTCGDeckBuilder/');
  });

  const importExportGameStateButton = document.getElementById(
    'importExportGameStateButton'
  );
  importExportGameStateButton.addEventListener('click', () => {
    const optionsContextMenu = document.getElementById('optionsContextMenu');
    optionsContextMenu.style.display = 'block';
    if (systemState.isTwoPlayer) {
      const p2Button = document.getElementById('p2Button');
      show('p2Box', p2Button);
      const p2OptionsButton = document.getElementById('p2OptionsButton');
      const p2Box = document.getElementById('p2Box');
      const adjustment = p2Box.offsetHeight - p2OptionsButton.offsetTop;
      optionsContextMenu.style.bottom = `${adjustment}px`;
    } else {
      const p1Button = document.getElementById('p1Button');
      show('p1Box', p1Button);
      const optionsButton = document.getElementById('optionsButton');
      const p1Box = document.getElementById('p1Box');
      const adjustment = p1Box.offsetHeight - optionsButton.offsetTop;
      optionsContextMenu.style.bottom = `${adjustment}px`;
    }
    document.addEventListener('mousedown', hideOptionsContextMenu);
  });
};
