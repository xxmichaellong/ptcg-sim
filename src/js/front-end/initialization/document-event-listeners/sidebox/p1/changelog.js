export const initializeChangelog = () => {  
    const changelogLink = document.getElementById('changelogLink');
    changelogLink.addEventListener('click', () => {
        if (changelog.style.display === 'block') {
            changelog.style.display = 'none';
        } else {
            changelog.style.display = 'block';
        };
    });
    
    const changelog = document.getElementById('changelog');
    changelog.addEventListener('click', () => {
        if (changelog.style.display === 'block') {
            changelog.style.display = 'none';
        };
    });
};