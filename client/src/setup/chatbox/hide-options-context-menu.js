export const hideOptionsContextMenu = (event) => {
  const optionsContextMenu = document.getElementById('optionsContextMenu');
  if (!optionsContextMenu.contains(event.target)) {
    optionsContextMenu.style.display = 'none';
    document.removeEventListener('mousedown', hideOptionsContextMenu);
  }
};
