const changelogLink = document.getElementById('changelogLink');
const changelog = document.getElementById('changelog');

// Handle click event on the changelog link
changelogLink.addEventListener('click', () => {
  if (changelog.style.display === 'block') {
    changelog.style.display = 'none';
  } else {
    changelog.style.display = 'block';
  };
});

changelog.addEventListener('click', () => {
    if (changelog.style.display === 'block') {
      changelog.style.display = 'none';
    };
});