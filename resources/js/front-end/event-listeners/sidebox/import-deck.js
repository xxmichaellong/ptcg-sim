import { altDeckImportInput, altImportHeaderButton, failedText, importButton, invalid, mainDeckImportInput, mainImportHeaderButton, randomButton, successText } from "../../front-end.js";
import { importDecklist } from "../../setup/deck-constructor/import.js";
import { sampleLists } from "../../setup/deck-constructor/sample.decklists.js";

mainImportHeaderButton.addEventListener('click', () => {
    if (mainImportHeaderButton.classList.contains('main-select')){
        return;
    } else {
        mainImportHeaderButton.classList.toggle('main-select');
        altImportHeaderButton.classList.toggle('alt-select');
        mainDeckImportInput.style.display = 'inline-block';
        altDeckImportInput.style.display = 'none';
        successText.style.display = 'none';
        failedText.style.display = 'none';
        invalid.style.display = 'none';
    };
});

altImportHeaderButton.addEventListener('click', () => {
    if (altImportHeaderButton.classList.contains('alt-select')){
        return;
    } else {
        mainImportHeaderButton.classList.toggle('main-select');
        altImportHeaderButton.classList.toggle('alt-select');
        altDeckImportInput.style.display = 'inline-block';
        mainDeckImportInput.style.display = 'none';
        successText.style.display = 'none';
        failedText.style.display = 'none';
        invalid.style.display = 'none';
    };
});

importButton.addEventListener('click', () => {
    const user = mainDeckImportInput.style.display !== 'none' ? 'self' : 'opp';
    importDecklist(user);
});

randomButton.addEventListener('click', () => {
    const input = mainDeckImportInput.style.display !== 'none' ? mainDeckImportInput : altDeckImportInput;

    input.value = '';

    const randomList = sampleLists[Math.floor(Math.random() * sampleLists.length)];

    input.value = randomList;
});