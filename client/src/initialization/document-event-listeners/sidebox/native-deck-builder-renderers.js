const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const escapeCssUrl = (url = '') => String(url)
  .replaceAll("'", '%27')
  .replaceAll(')', '%29')
  .replaceAll('\\', '%5C');

export const renderSearchResults = ({ searchResultsEl, results, onSelect }) => {
  if (!searchResultsEl) return;

  if (!results || results.length === 0) {
    searchResultsEl.innerHTML = '';
    return;
  }

  searchResultsEl.innerHTML = results
    .map((card, index) => {
      const previewImage = card.images?.large || card.images?.small || card.image || '';
      const thumbImage = card.images?.small || card.image || '';
      const setName = escapeHtml(card.set?.name || 'Unknown Set');

      return `
        <button class="native-deck-builder-result" data-result-index="${index}"${previewImage ? ` data-preview-image="${escapeHtml(previewImage)}"` : ''} title="${escapeHtml(card.name)} · ${setName}">
          <img src="${escapeHtml(thumbImage)}" alt="${escapeHtml(card.name)}" class="native-deck-builder-result-image" />
          <span class="native-deck-builder-result-text">
            <strong>${escapeHtml(card.name)}</strong>
            <span>${setName}</span>
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

export const renderDeckCards = ({ cardsEl, sortedCards, onAdd, onRemove }) => {
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
      const safeCssUrl = escapeHtml(escapeCssUrl(imageUrl));

      return `
        <div class="native-deck-builder-deck-row"${safeImageUrl ? ` data-preview-image="${safeImageUrl}"` : ''}>
          <div class="native-deck-builder-deck-art"${imageUrl ? ` style="background-image: url('${safeCssUrl}');"` : ''} aria-hidden="true"></div>
          <div class="native-deck-builder-deck-overlay" aria-hidden="true"></div>
          <div class="native-deck-builder-deck-buttons">
            <button class="native-deck-builder-deck-btn native-deck-builder-deck-plus" data-add-index="${index}" aria-label="Add one ${safeName}" title="Add one ${safeName}">+</button>
            <button class="native-deck-builder-deck-btn native-deck-builder-deck-minus" data-remove-index="${index}" aria-label="Remove one ${safeName}" title="Remove one ${safeName}">−</button>
          </div>
          <div class="native-deck-builder-deck-text">x${card.count} — ${safeName} <span class="native-deck-builder-deck-type">(${safeSupertype})</span></div>
        </div>`;
    })
    .join('');

  cardsEl.querySelectorAll('[data-add-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = sortedCards[Number(button.dataset.addIndex)];
      onAdd(card);
    });
  });

  cardsEl.querySelectorAll('[data-remove-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = sortedCards[Number(button.dataset.removeIndex)];
      onRemove(card);
    });
  });
};
