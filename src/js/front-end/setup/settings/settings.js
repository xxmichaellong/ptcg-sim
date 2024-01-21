import { oppContainerDocument, selfContainerDocument } from "../../front-end.js";

export const showOutlines = () => {
    const containerIds = ['active', 'bench', 'prizes', 'deckCover', 'lostZoneCover', 'discardCover'];

    containerIds.forEach(id => {
        selfContainerDocument.getElementById(id).classList.toggle('outline');
        oppContainerDocument.getElementById(id).classList.toggle('outline');
    });
    
    document.getElementById('stadium').classList.toggle('outline');    
}

export const darkMode = () => {
    // Dark Mode 1
    document.body.classList.toggle('dark-mode-1');
    
    const elementIds1 = [
        'chatbox', 'p2Chatbox', 'messageInput', 'p2MessageInput', 'p2ExplanationBox', 
        'settingsToggles', 'nameInput', 'roomIdInput'
    ];
    
    elementIds1.forEach(id => {
        document.getElementById(id).classList.toggle('dark-mode-1');
    });
    
    selfContainerDocument.getElementById('innerCircle').classList.toggle('dark-mode-1');
    oppContainerDocument.getElementById('innerCircle').classList.toggle('dark-mode-1');

    // Dark Mode 2
    const elementIds2 = [
        'p1Box', 'p2Box', 'settings', 'deckImport',
        'mainDeckImportInput', 'altDeckImportInput',
        'deckHeader', 'handHeader', 'boardHeader', 'prizesHeader'
    ];

    document.querySelectorAll('.card-context-menu, .card-sub-menu').forEach(menu => {
        menu.classList.toggle('dark-mode-2');
    });

    elementIds2.forEach(id => {
        document.getElementById(id).classList.toggle('dark-mode-2');
    });

    document.querySelector('.selected-page').classList.toggle('dark-mode-2');

    document.querySelectorAll('#boardButtonContainer button').forEach(button => {
        button.classList.toggle('dark-mode-2');
    });
    selfContainerDocument.querySelectorAll('#specialMoveButtonContainer button').forEach(button => {
        button.classList.toggle('dark-mode-2');
    });
    oppContainerDocument.querySelectorAll('#specialMoveButtonContainer button').forEach(button => {
        button.classList.toggle('dark-mode-2');
    });

    // Dark Mode 3
    selfContainerDocument.querySelectorAll('.self-text, .opp-text').forEach(text => {
        text.classList.toggle('dark-mode-3');
    });
    oppContainerDocument.querySelectorAll('.self-text, .opp-text').forEach(text => {
        text.classList.toggle('dark-mode-3');
    });

    // Dark Mode 4
    oppContainerDocument.querySelectorAll('.zone-button-container, .self-zone-button-container, .opp-zone-button-container').forEach(header => {
        header.classList.toggle('dark-mode-4');
    });
    selfContainerDocument.querySelectorAll('.zone-button-container, .self-zone-button-container, .opp-zone-button-container').forEach(header => {
        header.classList.toggle('dark-mode-4');
    });

    // Dark Mode 5
    selfContainerDocument.querySelectorAll('.self-view, .opp-view').forEach(background => {
        background.classList.toggle('dark-mode-5');
    });
    oppContainerDocument.querySelectorAll('.self-view, .opp-view').forEach(background => {
        background.classList.toggle('dark-mode-5');
    });

    // Dark Mode 6
    document.getElementById('changelog').classList.toggle('dark-mode-6');
    document.getElementById('donationsPage').classList.toggle('dark-mode-6');
    document.getElementById('keybindModal').classList.toggle('dark-mode-6');
    document.getElementById('languageDropdown').classList.toggle('dark-mode-6');
    document.getElementById('decklistTable').classList.toggle('dark-mode-6');
    document.querySelectorAll('.decklists-context-menu').forEach(menu => {
        menu.classList.toggle('dark-mode-6');
    });
}