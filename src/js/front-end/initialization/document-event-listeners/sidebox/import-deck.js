import { importDecklist } from "../../../setup/deck-constructor/import.js";
import { getRandomDeckList, showDecklistsContextMenu } from "../../../setup/deck-constructor/sample.decklists.js";

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
    }
    setInterval(updateLoadingText, 500);
    const uploadFileButton = document.getElementById('uploadFileButton');
    const changeCardBackButton = document.getElementById('changeCardBackButton');

    const mainImportHeaderButton = document.getElementById('mainImportHeaderButton');
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
            mainDeckImportInput.style.display = 'inline-block';
            altDeckImportInput.style.display = 'none';
            successText.style.display = 'none';
            failedText.style.display = 'none';
            invalidText.style.display = 'none';
        };
    });

    const altImportHeaderButton = document.getElementById('altImportHeaderButton');
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
            altDeckImportInput.style.display = 'inline-block';
            mainDeckImportInput.style.display = 'none';
            successText.style.display = 'none';
            failedText.style.display = 'none';
            invalidText.style.display = 'none';
        };
    });

    const importButton = document.getElementById('importButton');
    importButton.addEventListener('click', () => {
        const user = mainDeckImportInput.style.display !== 'none' ? 'self' : 'opp';
        importDecklist(user);
    });

    const randomButton = document.getElementById('randomButton');
    randomButton.addEventListener('click', () => {
        const input = mainDeckImportInput.style.display !== 'none' ? mainDeckImportInput : altDeckImportInput;
        input.value = '';
        input.value = getRandomDeckList();
    });

    const decklistsButton = document.getElementById('decklistsButton');
    decklistsButton.addEventListener('click', showDecklistsContextMenu);
};