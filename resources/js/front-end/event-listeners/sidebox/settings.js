import { darkModeCheckbox, p1Box, p2Box, settings, settingsToggles, showContainersCheckbox, chatbox, messageInput, nameInput, p2Chatbox, p2MessageInput, roomIdInput, stadium_html, deckImport, selfContainersDocument, oppContainersDocument, keybindModal, mainDeckImportInput, altDeckImportInput, p2ExplanationBox, changelog } from "../../front-end.js";
import { stringToVariable } from "../../setup/containers/string-to-variable.js";

const darkMode = () => {
    changelog.classList.toggle('dark-mode-6');
    document.body.classList.toggle('dark-mode');
    chatbox.classList.toggle('dark-mode');
    p2Chatbox.classList.toggle('dark-mode');
    messageInput.classList.toggle('dark-mode');
    p2MessageInput.classList.toggle('dark-mode');
    p2ExplanationBox.classList.toggle('dark-mode');
    settingsToggles.classList.toggle('dark-mode');
    nameInput.classList.toggle('dark-mode');
    roomIdInput.classList.toggle('dark-mode');
    p1Box.classList.toggle('dark-mode-2');
    p2Box.classList.toggle('dark-mode-2');
    settings.classList.toggle('dark-mode-2');
    deckImport.classList.toggle('dark-mode-2');
    mainDeckImportInput.classList.toggle('dark-mode-2');
    altDeckImportInput.classList.toggle('dark-mode-2');
    document.querySelector('.selected-page').classList.toggle('dark-mode-2');
    const buttons = document.querySelectorAll('#boardButtonContainer button');
    buttons.forEach(button => {
        button.classList.toggle('dark-mode-2');
    });
    const selfButtons = selfContainersDocument.querySelectorAll('#buttonContainer button');
    selfButtons.forEach(button => {
        button.classList.toggle('dark-mode-2');
    });
    const oppButtons = oppContainersDocument.querySelectorAll('#buttonContainer button');
    oppButtons.forEach(button => {
        button.classList.toggle('dark-mode-2');
    });
    selfContainersDocument.querySelector('#innerCircle').classList.toggle('dark-mode');
    oppContainersDocument.querySelector('#innerCircle').classList.toggle('dark-mode');
    const selfText = selfContainersDocument.querySelectorAll('.self-text, .opp-text');
    selfText.forEach(text => {
        text.classList.toggle('dark-mode-3');
    });
    const oppText = oppContainersDocument.querySelectorAll('.self-text, .opp-text');
    oppText.forEach(text => {
        text.classList.toggle('dark-mode-3');
    });
    const oppHeader = oppContainersDocument.querySelectorAll('.stack-button-container, .self-button-container, .opp-button-container');
    oppHeader.forEach(header => {
        header.classList.toggle('dark-mode-4');
    });
    const selfHeader = selfContainersDocument.querySelectorAll('.stack-button-container, .self-button-container, .opp-button-container');
    selfHeader.forEach(header => {
        header.classList.toggle('dark-mode-4');
    });
    const selfBackground = selfContainersDocument.querySelectorAll('.self-view, .opp-view');
    selfBackground.forEach(background => {
      background.classList.toggle('dark-mode-5');
    });
    const oppBackGround = oppContainersDocument.querySelectorAll('.self-view, .opp-view');
    oppBackGround.forEach(background => {
      background.classList.toggle('dark-mode-5');
    });
    const contextMenu = document.querySelectorAll('.contextMenu, .subMenu');
    contextMenu.forEach(item => {
        item.classList.toggle('dark-mode-2');
    });
    document.getElementById('deckHeader').classList.toggle('dark-mode-2');
    document.getElementById('handHeader').classList.toggle('dark-mode-2');
    document.getElementById('prizesHeader').classList.toggle('dark-mode-2');
    keybindModal.classList.toggle('dark-mode-6');
}

const showContainers = () => {
    const containers = ['bench_html', 'active_html', 'deckDisplay_html', 'lostzoneDisplay_html', 'discardDisplay_html', 'prizes_html'];
    const users = ['self', 'opp'];

    users.forEach(user => {
        containers.forEach(containerId => {
            const container_html = stringToVariable(user, containerId);
            container_html.classList.toggle('base');
        });
    });
    stadium_html.classList.toggle('base');
}

darkModeCheckbox.addEventListener('change', darkMode);
showContainersCheckbox.addEventListener('change', showContainers)

