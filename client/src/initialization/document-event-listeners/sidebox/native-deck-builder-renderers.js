const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export const renderSearchResults = ({ searchResultsEl, results, onSelect }) => {
  if (!searchResultsEl) return;

  if (!results || results.length === 0) {
    searchResultsEl.innerHTML = '';
    return;
  }

  searchResultsEl.innerHTML = results
    .map((card, index) => {
      const detailParts = [];
      if (card.number) detailParts.push(card.number);
      if (card.set?.releaseDate) detailParts.push(card.set.releaseDate);
      const detailLine = detailParts.length > 0 ? `<span>${detailParts.join(' · ')}</span>` : '';

      const previewImage = card.images?.large || card.images?.small || card.image || '';

      return `
        <button class="native-deck-builder-result" data-result-index="${index}"${previewImage ? ` data-preview-image="${escapeHtml(previewImage)}"` : ''}>
          <img src="${card.images?.small || card.image}" alt="${card.name}" class="native-deck-builder-result-image" />
          <span class="native-deck-builder-result-text">
            <strong>${card.name}</strong>
            <span>${card.supertype} · ${card.set?.name || 'Unknown Set'}</span>
            ${detailLine}
          </span>
        </button>
      `;
    })
    .join('');

  searchResultsEl.querySelectorAll('[data-result-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = results[Number(button.dataset.resultIndex)];
      onSelect(card);
    });
  });
};

export const renderDeckCards = ({ cardsEl, sortedCards, onRemove }) => {
  if (!cardsEl) return;

  if (!sortedCards || sortedCards.length === 0) {
    cardsEl.innerHTML = 'No cards added yet.';
    return;
  }

  cardsEl.innerHTML = sortedCards
    .map((card, index) => {
      const imageUrl = card.images?.small || card.images?.large || card.image || '';
      const safeName = escapeHtml(card.name || 'Unknown Card');
      const safeSupertype = escapeHtml(card.supertype || 'Unknown');
      const safeImageUrl = escapeHtml(imageUrl);

      return `
        <div class="native-deck-builder-deck-row"${safeImageUrl ? ` data-preview-image="${safeImageUrl}"` : ''}>
          <div class="native-deck-builder-deck-art"${safeImageUrl ? ` style="background-image: url('${safeImageUrl}');"` : ''} aria-hidden="true"></div>
          <div class="native-deck-builder-deck-overlay" aria-hidden="true"></div>
          <button class="native-deck-builder-deck-minus" data-deck-index="${index}" aria-label="Remove one ${safeName}" title="Remove one ${safeName}">−</button>
          <div class="native-deck-builder-deck-text">x${card.count} — ${safeName} <span class="native-deck-builder-deck-type">(${safeSupertype})</span></div>
        </div>`;
    })
    .join('');

  cardsEl.querySelectorAll('[data-deck-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = sortedCards[Number(button.dataset.deckIndex)];
      onRemove(card);
    });
  });
};
