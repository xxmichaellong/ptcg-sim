export const initializeDonationsLink = () => {
  const changelog = document.getElementById('changelog');

  const donationsLink = document.getElementById('donationsLink');
  donationsLink.addEventListener('click', () => {
    if (donationsPage.style.display === 'block') {
      donationsPage.style.display = 'none';
    } else {
      donationsPage.style.display = 'block';
      changelog.style.display = 'none';
    }
  });

  const donationsPage = document.getElementById('donationsPage');
  donationsPage.addEventListener('click', () => {
    if (donationsPage.style.display === 'block') {
      donationsPage.style.display = 'none';
    }
  });
};
