export const initializeChangelog = () => {
  const donationsPage = document.getElementById('donationsPage');

  const changelogLink = document.getElementById('changelogLink');
  changelogLink.addEventListener('click', () => {
    if (changelog.style.display === 'block') {
      changelog.style.display = 'none';
    } else {
      changelog.style.display = 'block';
      donationsPage.style.display = 'none';
    }
  });

  const changelog = document.getElementById('changelog');
  changelog.addEventListener('click', () => {
    if (changelog.style.display === 'block') {
      changelog.style.display = 'none';
    }
  });
};
