export const applyLoadFeedback = ({
  loadStatusEl,
  loadButtonEl,
  targetName,
  rowCount,
  isError = false,
}) => {
  if (loadStatusEl) {
    loadStatusEl.textContent = isError
      ? `Couldn't load deck into ${targetName}`
      : `Deck loaded into ${targetName}`;
    loadStatusEl.classList.add('visible');
    loadStatusEl.classList.toggle('error', isError);
  }

  if (loadButtonEl) {
    loadButtonEl.classList.toggle('load-success', !isError);
  }
};
