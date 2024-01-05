import { darkModeCheckbox, p1Box, p2Box, settings, settingsToggles, showZonesCheckbox, chatbox, messageInput, nameInput, p2Chatbox, p2MessageInput, roomIdInput, stadiumElement, deckImport, selfContainerDocument, oppContainerDocument, keybindModal, mainDeckImportInput, altDeckImportInput, p2ExplanationBox, changelog } from "../../front-end.js";
import { stringToVariable } from "../../setup/zones/zone-string-to-variable.js";

const darkMode = () => {
    changelog.classList.toggle('dark-mode-6');
    document.body.classList.toggle('dark-mode-1');
    chatbox.classList.toggle('dark-mode-1');
    p2Chatbox.classList.toggle('dark-mode-1');
    messageInput.classList.toggle('dark-mode-1');
    p2MessageInput.classList.toggle('dark-mode-1');
    p2ExplanationBox.classList.toggle('dark-mode-1');
    settingsToggles.classList.toggle('dark-mode-1');
    nameInput.classList.toggle('dark-mode-1');
    roomIdInput.classList.toggle('dark-mode-1');
    p1Box.classList.toggle('dark-mode-2');
    p2Box.classList.toggle('dark-mode-2');
    settings.classList.toggle('dark-mode-2');
    deckImport.classList.toggle('dark-mode-2');
    mainDeckImportInput.classList.toggle('dark-mode-2');
    altDeckImportInput.classList.toggle('dark-mode-2');
    document.querySelector('.selected-page').classList.toggle('dark-mode-2');
    const buttons = document.querySelectorAll('#boardButtonsContainer button');
    buttons.forEach(button => {
        button.classList.toggle('dark-mode-2');
    });
    const selfButtons = selfContainerDocument.querySelectorAll('#specialMoveButtonContainer button');
    selfButtons.forEach(button => {
        button.classList.toggle('dark-mode-2');
    });
    const oppButtons = oppContainerDocument.querySelectorAll('#specialMoveButtonContainer button');
    oppButtons.forEach(button => {
        button.classList.toggle('dark-mode-2');
    });
    selfContainerDocument.querySelector('#innerCircle').classList.toggle('dark-mode-1');
    oppContainerDocument.querySelector('#innerCircle').classList.toggle('dark-mode-1');
    const selfText = selfContainerDocument.querySelectorAll('.self-text, .opp-text');
    selfText.forEach(text => {
        text.classList.toggle('dark-mode-3');
    });
    const oppText = oppContainerDocument.querySelectorAll('.self-text, .opp-text');
    oppText.forEach(text => {
        text.classList.toggle('dark-mode-3');
    });
    const oppHeader = oppContainerDocument.querySelectorAll('.zone-button-container, .self-zone-button-container, .opp-zone-button-container');
    oppHeader.forEach(header => {
        header.classList.toggle('dark-mode-4');
    });
    const selfHeader = selfContainerDocument.querySelectorAll('.zone-button-container, .self-zone-button-container, .opp-zone-button-container');
    selfHeader.forEach(header => {
        header.classList.toggle('dark-mode-4');
    });
    const selfBackground = selfContainerDocument.querySelectorAll('.self-view, .opp-view');
    selfBackground.forEach(background => {
      background.classList.toggle('dark-mode-5');
    });
    const oppBackGround = oppContainerDocument.querySelectorAll('.self-view, .opp-view');
    oppBackGround.forEach(background => {
      background.classList.toggle('dark-mode-5');
    });
    const contextMenu = document.querySelectorAll('.card-context-menu, .card-sub-menu');
    contextMenu.forEach(item => {
        item.classList.toggle('dark-mode-2');
    });
    document.getElementById('deckHeader').classList.toggle('dark-mode-2');
    document.getElementById('handHeader').classList.toggle('dark-mode-2');
    document.getElementById('boardHeader').classList.toggle('dark-mode-2');
    document.getElementById('prizesHeader').classList.toggle('dark-mode-2');
    keybindModal.classList.toggle('dark-mode-6');
}

const showElements = () => {
    const elements = ['benchElement', 'activeElement', 'deckCoverElement', 'lostZoneCoverElement', 'discardCoverElement', 'prizesElement'];
    const users = ['self', 'opp'];

    users.forEach(user => {
        elements.forEach(zoneElementString => {
            const element = stringToVariable(user, zoneElementString);
            element.classList.toggle('outline');
        });
    });
    stadiumElement.classList.toggle('outline');
}

darkModeCheckbox.addEventListener('change', darkMode);
showZonesCheckbox.addEventListener('change', showElements)

