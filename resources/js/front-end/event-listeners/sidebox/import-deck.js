import { altDeckImportInput, altImportHeaderButton, failedText, importButton, mainDeckImportInput, mainImportHeaderButton, successText } from "../../front-end.js";
import { importDecklist } from "../../setup/deck-constructor/import.js";

importButton.addEventListener('click', () => {
    const user = mainDeckImportInput.style.display !== 'none' ? 'self' : 'opp';
    importDecklist(user);
});

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
    };
});