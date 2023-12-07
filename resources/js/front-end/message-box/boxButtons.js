function show(id) {
    // Get all the elements
    const home = document.getElementById('home');
    const pvp = document.getElementById('pvp');
    const deckImport = document.getElementById('deckImport');
    const settings = document.getElementById('settings');

    // Hide all the elements
    deckImport.style.display = 'none';
    settings.style.display = 'none';
    home.style.display = 'none';
    pvp.style.display = 'none';

    // Show the selected element
    document.getElementById(id).style.display = 'flex';
}

const homeButton = document.getElementById('homeButton');
const pvpButton = document.getElementById('pvpButton');
const deckImportButton = document.getElementById('deckImportButton');
const settingsButton = document.getElementById('settingsButton');

homeButton.addEventListener('click', () => {show('home')});
pvpButton.addEventListener('click', () => {show('pvp')});
deckImportButton.addEventListener('click', () => {show('deckImport')});
settingsButton.addEventListener('click', () => {show('settings')});