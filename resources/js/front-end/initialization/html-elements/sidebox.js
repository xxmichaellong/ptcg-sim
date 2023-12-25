export const p1Box = document.getElementById('p1Box');
export const p2Box = document.getElementById('p2Box');
export const deckImport = document.getElementById('deckImport');
export const settings = document.getElementById('settings');

//home page
export const videoContainer = document.getElementById('videoContainer');
export const tutorialButton = document.getElementById('tutorialButton');

//settings
export const darkModeCheckbox = document.getElementById('darkModeCheckbox');
export const showContainersCheckbox = document.getElementById('showContainersCheckbox');
export const settingsToggles = document.getElementById('settingsToggles');

//deck import
export const successText = document.getElementById('success');
export const failedText = document.getElementById('failed');
export const loadingText = document.getElementById('loading');
export const invalid = document.getElementById('invalid');
export const deckImportExplanationBox = document.getElementById('deckImportExplanationBox');
export const decklistsContextMenu = document.getElementById('decklistsContextMenu');

const updateLoadingText = () => {
    const dots = loadingText.innerHTML.match(/\./g) || [];
    const dotCount = dots.length;
    const maxDots = 3;
    const newDotCount = (dotCount + 1) % (maxDots + 1);
    const newText = 'Loading' + '.'.repeat(newDotCount);
    loadingText.innerHTML = newText;
}
setInterval(updateLoadingText, 500);
