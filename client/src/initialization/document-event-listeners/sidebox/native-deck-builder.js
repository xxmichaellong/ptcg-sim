import {
  formatImageUrl,
  parseSimCsv,
  serializeDeckToSimCsv,
} from '../../../setup/deck-builder/core/csv-adapter.mjs';
import { getSortedDeckCardArray } from '../../../setup/deck-builder/core/card-sort.mjs';
import {
  detectDeckFormat,
  validateDeck,
} from '../../../setup/deck-builder/core/deck-validation.mjs';
import { systemState } from '../../../front-end.js';
import { loadDeckData } from '../../../setup/deck-constructor/import.js';
import { show } from '../../../setup/home-header/header-toggle.js';
import {
  renderDeckCards,
  renderSearchResults,
} from './native-deck-builder-renderers.js';
import { syncDeckFromLoadedRows } from './native-deck-builder-sync.js';
import {
  addCard,
  createEmptyDeck,
  getDeckCounts,
  removeCard,
} from '../../../setup/deck-builder/core/deck-state.mjs';
import {
  applyLocalControls,
  queryCardsByName,
} from '../../../setup/deck-builder/core/card-search.mjs';

const deckToSimRows = (deck = {}) => {
  const rows = [];

  for (const cardName in deck) {
    const group = deck[cardName];
    for (const variant of group?.cards || []) {
      rows.push([
        String(variant.count),
        cardName,
        variant?.data?.supertype || '',
        formatImageUrl(variant?.data || {}),
      ]);
    }
  }

  return rows;
};

export const initializeNativeDeckBuilder = () => {
  const targetMainButton = document.getElementById(
    'nativeDeckBuilderTargetMain'
  );
  const targetAltButton = document.getElementById('nativeDeckBuilderTargetAlt');

  const playButton = document.getElementById('nativeDeckBuilderPlayButton');
  const exportCsvButton = document.getElementById('nativeDeckBuilderExportCsv');
  const importCsvLabel = document.getElementById(
    'nativeDeckBuilderImportCsvLabel'
  );
  const importCsvInput = document.getElementById('nativeDeckBuilderCsvImport');
  const clearButton = document.getElementById('nativeDeckBuilderClear');
  const deckStatus = document.getElementById('nativeDeckBuilderDeckStatus');
  const summary = document.getElementById('nativeDeckBuilderSummaryPanel');
  const validationDot = document.getElementById(
    'nativeDeckBuilderValidationDot'
  );
  const cards = document.getElementById('nativeDeckBuilderCardsPanel');
  const searchInput = document.getElementById('nativeDeckBuilderSearchInput');
  const cardTypeFilter = document.getElementById(
    'nativeDeckBuilderCardTypeFilter'
  );
  const sortBySelect = document.getElementById('nativeDeckBuilderSortBy');
  const sortDirectionSelect = document.getElementById(
    'nativeDeckBuilderSortDirection'
  );
  const searchButton = document.getElementById('nativeDeckBuilderSearchButton');
  const searchStatus = document.getElementById('nativeDeckBuilderSearchStatus');
  const searchResults = document.getElementById(
    'nativeDeckBuilderSearchResults'
  );
  const previewScrim = document.getElementById(
    'nativeDeckBuilderCardPreviewScrim'
  );
  const previewImage = document.getElementById(
    'nativeDeckBuilderCardPreviewImage'
  );
  const addCustomCardButton = document.getElementById(
    'nativeDeckBuilderAddCustomCard'
  );
  const customCardModal = document.getElementById(
    'nativeDeckBuilderCustomCardModal'
  );
  const customCardQty = document.getElementById('nativeCustomCardQty');
  const customCardName = document.getElementById('nativeCustomCardName');
  const customCardType = document.getElementById('nativeCustomCardType');
  const customCardImageUrl = document.getElementById(
    'nativeCustomCardImageUrl'
  );
  const customCardError = document.getElementById('nativeCustomCardError');
  const customCardCancel = document.getElementById('nativeCustomCardCancel');
  const customCardSubmit = document.getElementById('nativeCustomCardSubmit');
  const customCardPreviewImage = document.getElementById(
    'nativeCustomCardPreviewImage'
  );
  const customCardPreviewPlaceholder = document.getElementById(
    'nativeCustomCardPreviewPlaceholder'
  );

  playButton.addEventListener('click', () => {
    if (systemState.isTwoPlayer) {
      show('p2Box', document.getElementById('p2Button'));
    } else {
      show('p1Box', document.getElementById('p1Button'));
    }
    document.dispatchEvent(new CustomEvent('deck-builder-closing'));
    const panel = document.getElementById('nativeDeckBuilderWorkspace');
    if (panel) panel.classList.remove('open');
  });

  const syncedDecks = {
    self: createEmptyDeck(),
    opp: createEmptyDeck(),
  };

  let deck = createEmptyDeck();
  let currentResults = [];
  let currentRawResults = [];
  let currentLoadTarget = 'self';
  let currentTotalSummaries = 0;
  let currentHugeResultSet = false;
  let currentProviderNotice = '';
  let currentSearchController = null;
  let deckDirty = false;
  let flashFrame = null;

  const flashDeckStatus = () => {
    if (!deckStatus) return;
    if (flashFrame) cancelAnimationFrame(flashFrame);
    deckStatus.classList.remove('flash');
    flashFrame = requestAnimationFrame(() => {
      deckStatus.classList.add('flash');
      flashFrame = requestAnimationFrame(() => {
        deckStatus.classList.remove('flash');
        flashFrame = null;
      });
    });
  };

  const renderResults = () => {
    renderSearchResults({
      searchResultsEl: searchResults,
      results: currentResults,
      onSelect: (card) => {
        deck = addCard(deck, card);
        deckDirty = true;
        render();
        flashDeckStatus();
      },
    });
  };

  const updateVisibleResults = () => {
    currentResults = applyLocalControls(currentRawResults, {
      cardType: cardTypeFilter.value,
      sortBy: sortBySelect.value,
      sortDirection: sortDirectionSelect.value,
    });
  };

  const getSearchStatusText = () => {
    const notice = currentProviderNotice ? `${currentProviderNotice} ` : '';
    if (currentHugeResultSet) {
      return `${notice}Too many results (${currentTotalSummaries}). Please redefine your search terms.`;
    }
    const base =
      currentResults.length > 0
        ? `Showing all ${currentResults.length} result(s). Click a card to add it.`
        : 'No matching cards found.';
    return `${notice}${base}`;
  };

  const switchTarget = (target) => {
    if (target === currentLoadTarget) return;
    syncedDecks[currentLoadTarget] = deck;
    currentLoadTarget = target;
    deck = syncedDecks[target];
    render();
  };

  const showCardPreview = (imageUrl) => {
    if (!previewScrim || !previewImage || !imageUrl) return;
    previewImage.src = imageUrl;
    previewScrim.removeAttribute('hidden');
  };

  const hideCardPreview = () => {
    if (!previewScrim) return;
    previewScrim.setAttribute('hidden', '');
    previewImage.removeAttribute('src');
  };

  if (previewScrim) {
    previewScrim.addEventListener('click', hideCardPreview);
  }

  // Right-click on search results opens preview
  if (searchResults) {
    searchResults.addEventListener('contextmenu', (event) => {
      const target = event.target.closest('[data-preview-image]');
      if (!target) return;
      event.preventDefault();
      showCardPreview(target.dataset.previewImage);
    });
  }

  // Click on deck cards opens preview
  if (cards) {
    cards.addEventListener('click', (event) => {
      const target = event.target.closest('[data-preview-image]');
      if (!target) return;
      // Don't open preview if clicking the add/remove buttons
      if (event.target.closest('.native-deck-builder-deck-btn')) return;
      showCardPreview(target.dataset.previewImage);
    });
  }

  document.addEventListener('native-deck-builder:deck-loaded', (event) => {
    const user = event.detail?.user;
    const deckData = event.detail?.deckData;
    if (!user || !Array.isArray(deckData)) return;

    syncedDecks[user] = syncDeckFromLoadedRows(deckData);

    if (currentLoadTarget === user) {
      deck = syncedDecks[user];

      render();
    }
  });

  let customCardImageLoaded = false;

  const showPreviewImage = () => {
    customCardPreviewImage.style.display = '';
    customCardPreviewPlaceholder.style.display = 'none';
  };

  const showPreviewPlaceholder = (text = 'No image') => {
    customCardPreviewImage.style.display = 'none';
    customCardPreviewPlaceholder.style.display = '';
    customCardPreviewPlaceholder.textContent = text;
  };

  const updateCustomCardPreview = (url) => {
    const trimmed = url.trim();
    customCardImageLoaded = false;

    if (!trimmed) {
      showPreviewPlaceholder('No image');
      return;
    }

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      showPreviewPlaceholder('Invalid URL');
      return;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      showPreviewPlaceholder('http/https only');
      return;
    }

    showPreviewPlaceholder('Loading…');
    customCardPreviewImage.src = trimmed;
  };

  customCardImageUrl.addEventListener('input', () => {
    updateCustomCardPreview(customCardImageUrl.value);
  });

  customCardPreviewImage.addEventListener('error', () => {
    customCardImageLoaded = false;
    showPreviewPlaceholder('Image not found');
  });

  customCardPreviewImage.addEventListener('load', () => {
    customCardImageLoaded = true;
    showPreviewImage();
  });

  const openCustomCardModal = () => {
    customCardQty.value = '1';
    customCardName.value = '';
    customCardType.value = 'Pokémon';
    customCardImageUrl.value = '';
    customCardError.textContent = '';
    customCardImageLoaded = false;
    customCardPreviewImage.removeAttribute('src');
    showPreviewPlaceholder('No image');
    customCardModal.removeAttribute('hidden');
    customCardName.focus();
  };

  const closeCustomCardModal = () => {
    customCardModal.setAttribute('hidden', '');
  };

  addCustomCardButton.addEventListener('click', openCustomCardModal);
  customCardCancel.addEventListener('click', closeCustomCardModal);

  customCardModal.addEventListener('click', (event) => {
    if (event.target === customCardModal) closeCustomCardModal();
  });

  customCardSubmit.addEventListener('click', () => {
    const qty = parseInt(customCardQty.value, 10);
    const name = customCardName.value.trim();
    const type = customCardType.value;
    const imageUrl = customCardImageUrl.value.trim();

    if (!name) {
      customCardError.textContent = 'Card Name is required.';
      return;
    }
    if (!qty || qty < 1) {
      customCardError.textContent = 'Quantity must be at least 1.';
      return;
    }
    if (!imageUrl) {
      customCardError.textContent = 'Image URL is required.';
      return;
    }
    if (!customCardImageLoaded) {
      customCardError.textContent = 'Image URL must point to a loadable image.';
      return;
    }

    const card = {
      id: `custom:${name}:${type}:${imageUrl}`,
      name,
      supertype: type,
      images: { small: imageUrl, large: imageUrl },
      image: imageUrl,
      set: { id: '', name: '', releaseDate: '' },
      number: '',
      _provider: 'custom',
    };

    for (let i = 0; i < qty; i++) {
      deck = addCard(deck, card);
    }

    deckDirty = true;
    closeCustomCardModal();
    render();
    flashDeckStatus();
  });

  const render = () => {
    const counts = getDeckCounts(deck);
    const result = validateDeck(deck, detectDeckFormat(deck));
    const sortedCards = getSortedDeckCardArray(deck);
    const hasDeckCards = Object.keys(deck).length > 0;

    clearButton.style.display = hasDeckCards ? '' : 'none';
    playButton.disabled = !hasDeckCards;
    targetAltButton.style.cursor = systemState.isTwoPlayer
      ? 'default'
      : 'pointer';
    targetAltButton.style.opacity = systemState.isTwoPlayer ? '0.5' : '';

    if (deckStatus) {
      deckStatus.textContent = hasDeckCards ? 'Saved ✓' : '';
    }

    targetMainButton.classList.toggle(
      'native-target-selected',
      currentLoadTarget === 'self'
    );
    targetAltButton.classList.toggle(
      'native-target-selected',
      currentLoadTarget === 'opp'
    );

    const isSelf = currentLoadTarget === 'self';
    for (const el of [exportCsvButton, importCsvLabel, clearButton]) {
      if (!el) continue;
      el.classList.toggle('self-color', isSelf);
      el.classList.toggle('opp-color', !isSelf);
    }

    summary.innerHTML = [
      `Total: <strong>${counts.total}</strong>`,
      `Pokémon: <strong>${counts.pokemon}</strong>`,
      `Trainer: <strong>${counts.trainer}</strong>`,
      `Energy: <strong>${counts.energy}</strong>`,
    ].join(' · ');

    if (validationDot) {
      const formatLabel = result.formatName;
      const validationTitle = result.isValid
        ? `${formatLabel} · Valid (${result.totalCards} cards)`
        : `${formatLabel} · ${result.errors.join('\n')}`;

      validationDot.classList.toggle('valid', result.isValid);
      validationDot.classList.toggle('invalid', !result.isValid);
      validationDot.setAttribute('aria-label', validationTitle);
      validationDot.title = validationTitle;
    }

    renderDeckCards({
      cardsEl: cards,
      sortedCards,
      onAdd: (card) => {
        deck = addCard(deck, card);
        deckDirty = true;
        render();
        flashDeckStatus();
      },
      onRemove: (card) => {
        deck = removeCard(deck, card);
        deckDirty = true;
        render();
        flashDeckStatus();
      },
    });

    renderResults();
  };

  const loadCurrentDeck = () => {
    if (!deckDirty) return;
    deckDirty = false;
    syncedDecks[currentLoadTarget] = deck;
    const deckRows = deckToSimRows(deck);
    if (deckRows.length > 0) {
      loadDeckData(currentLoadTarget, deckRows);
    }
    render();
  };

  const runSearch = async (options = {}) => {
    const term = (options.term ?? searchInput.value).trim();

    currentSearchController?.abort();
    const searchController = new AbortController();
    currentSearchController = searchController;

    if (!term) {
      currentResults = [];
      currentRawResults = [];
      currentTotalSummaries = 0;
      currentHugeResultSet = false;
      currentProviderNotice = '';
      currentSearchController = null;
      searchStatus.textContent = '';
      render();
      return;
    }

    searchButton.disabled = true;
    searchStatus.textContent = `Searching for “${term}”...`;

    try {
      const searchResponse = await queryCardsByName(term, {
        cardType: cardTypeFilter.value,
        signal: searchController.signal,
      });
      if (currentSearchController !== searchController) return;

      currentRawResults = searchResponse.results;
      currentTotalSummaries = searchResponse.totalSummaries;
      currentHugeResultSet = searchResponse.isHugeResultSet;
      currentProviderNotice = searchResponse.notice || '';
      updateVisibleResults();

      searchStatus.textContent = getSearchStatusText();
    } catch (error) {
      if (searchController.signal.aborted) return;
      currentResults = [];
      currentRawResults = [];
      currentTotalSummaries = 0;
      currentHugeResultSet = false;
      currentProviderNotice = '';
      searchStatus.textContent = `Search failed: ${error.message}`;
    } finally {
      if (currentSearchController === searchController) {
        currentSearchController = null;
        searchButton.disabled = false;
        render();
      }
    }
  };

  targetMainButton.addEventListener('click', () => {
    switchTarget('self');
    document.dispatchEvent(
      new CustomEvent('deck-target-changed', { detail: { target: 'self' } })
    );
  });

  targetAltButton.addEventListener('click', () => {
    if (systemState.isTwoPlayer) return;
    switchTarget('opp');
    document.dispatchEvent(
      new CustomEvent('deck-target-changed', { detail: { target: 'opp' } })
    );
  });

  document.addEventListener('deck-target-changed', (event) => {
    const target = event.detail?.target;
    if (target) switchTarget(target);
  });

  exportCsvButton.addEventListener('click', () => {
    const csv = serializeDeckToSimCsv(deck);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ptcg-sim-deck.csv';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  });

  importCsvInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const csvText = await file.text();
      deck = parseSimCsv(csvText);
      syncedDecks[currentLoadTarget] = deck;
      deckDirty = true;
      render();
    } catch (error) {
      searchStatus.textContent = `CSV import failed: ${error.message}`;
    } finally {
      importCsvInput.value = '';
    }
  });

  clearButton.addEventListener('click', () => {
    if (!window.confirm('Are you sure you want to delete your deck?')) return;
    deck = createEmptyDeck();
    syncedDecks[currentLoadTarget] = deck;
    deckDirty = true;
    render();
  });

  const rerenderSearchLocally = () => {
    if (currentRawResults.length === 0) return;
    updateVisibleResults();
    searchStatus.textContent = getSearchStatusText();
    renderResults();
  };

  cardTypeFilter.addEventListener('change', rerenderSearchLocally);
  sortBySelect.addEventListener('change', rerenderSearchLocally);
  sortDirectionSelect.addEventListener('change', rerenderSearchLocally);

  searchButton.addEventListener('click', () => {
    runSearch();
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
    }
  });

  document.addEventListener('deck-builder-closing', () => {
    currentSearchController?.abort();
    currentSearchController = null;
    searchButton.disabled = false;
    loadCurrentDeck();
  });

  const deckImportButton = document.getElementById('deckImportButton');
  if (deckImportButton)
    deckImportButton.addEventListener('click', () => {
      if (systemState.isTwoPlayer && currentLoadTarget === 'opp') {
        switchTarget('self');
        document.dispatchEvent(
          new CustomEvent('deck-target-changed', { detail: { target: 'self' } })
        );
      }
      render();
    });

  render();
};
