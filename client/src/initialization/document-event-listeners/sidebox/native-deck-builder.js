import { addCard, createEmptyDeck, getDeckCounts, removeCard } from '../../../setup/deck-builder/core/deck-state.mjs';
import { applyLocalControls, queryCardsByName } from '../../../setup/deck-builder/core/card-search.mjs';
import { formatImageUrl, parseSimCsv, serializeDeckToSimCsv } from '../../../setup/deck-builder/core/csv-adapter.mjs';
import { getSortedDeckCardArray } from '../../../setup/deck-builder/core/card-sort.mjs';
import { DECK_FORMATS, validateDeck } from '../../../setup/deck-builder/core/deck-validation.mjs';
import { loadDeckData } from '../../../setup/deck-constructor/import.js';
import { renderDeckCards, renderSearchResults } from './native-deck-builder-renderers.js';
import { applyLoadFeedback } from './native-deck-builder-load-feedback.js';
import { syncDeckFromLoadedRows } from './native-deck-builder-sync.js';

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
  const panel = document.getElementById('nativeDeckBuilderWorkspace');
  const deckBuilderButton = document.getElementById('deckBuilderButton');
  const closeButton = document.getElementById('closeNativeDeckBuilderButton');
  const edgeToggleButton = document.getElementById('nativeDeckBuilderEdgeToggle');
  const targetMainButton = document.getElementById('nativeDeckBuilderTargetMain');
  const targetAltButton = document.getElementById('nativeDeckBuilderTargetAlt');
  const loadCurrentTargetButton = document.getElementById('nativeDeckBuilderLoadCurrentTarget');
  const targetLabel = document.getElementById('nativeDeckBuilderTargetLabel');
  const loadStatus = document.getElementById('nativeDeckBuilderLoadStatus');
  const exportCsvButton = document.getElementById('nativeDeckBuilderExportCsv');
  const importCsvInput = document.getElementById('nativeDeckBuilderCsvImport');
  const clearButton = document.getElementById('nativeDeckBuilderClear');
  const summary = document.getElementById('nativeDeckBuilderSummaryPanel');
  const validationDot = document.getElementById('nativeDeckBuilderValidationDot');
  const cards = document.getElementById('nativeDeckBuilderCardsPanel');
  const searchInput = document.getElementById('nativeDeckBuilderSearchInput');
  const cardTypeFilter = document.getElementById('nativeDeckBuilderCardTypeFilter');
  const sortBySelect = document.getElementById('nativeDeckBuilderSortBy');
  const sortDirectionSelect = document.getElementById('nativeDeckBuilderSortDirection');
  const searchButton = document.getElementById('nativeDeckBuilderSearchButton');
  const searchStatus = document.getElementById('nativeDeckBuilderSearchStatus');
  const searchResults = document.getElementById('nativeDeckBuilderSearchResults');
  const showCountSelect = document.getElementById('nativeDeckBuilderShowCount');
  const hoverPreview = document.getElementById('nativeDeckBuilderHoverPreview');
  const hoverPreviewImage = document.getElementById('nativeDeckBuilderHoverPreviewImage');
  const addCustomCardButton = document.getElementById('nativeDeckBuilderAddCustomCard');
  const customCardModal = document.getElementById('nativeDeckBuilderCustomCardModal');
  const customCardQty = document.getElementById('nativeCustomCardQty');
  const customCardName = document.getElementById('nativeCustomCardName');
  const customCardType = document.getElementById('nativeCustomCardType');
  const customCardImageUrl = document.getElementById('nativeCustomCardImageUrl');
  const customCardError = document.getElementById('nativeCustomCardError');
  const customCardCancel = document.getElementById('nativeCustomCardCancel');
  const customCardSubmit = document.getElementById('nativeCustomCardSubmit');
  const customCardPreviewImage = document.getElementById('nativeCustomCardPreviewImage');
  const customCardPreviewPlaceholder = document.getElementById('nativeCustomCardPreviewPlaceholder');

  const syncedDecks = {
    self: createEmptyDeck(),
    opp: createEmptyDeck(),
  };

  let deck = createEmptyDeck();
  let currentResults = [];
  let currentRawResults = [];
  let currentLoadTarget = 'self';
  let currentSearchTerm = '';
  let currentTotalSummaries = 0;
  let currentHugeResultSet = false;
  let loadFeedbackTimer = null;

  const renderResults = () => {
    renderSearchResults({
      searchResultsEl: searchResults,
      results: currentResults,
      onSelect: (card) => {
        deck = addCard(deck, card);
        render();
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

  const hideHoverPreview = () => {
    if (!hoverPreview || !hoverPreviewImage) return;
    hoverPreview.classList.remove('visible');
    hoverPreview.setAttribute('aria-hidden', 'true');
    hoverPreviewImage.removeAttribute('src');
  };

  const clearLoadFeedback = () => {
    if (loadFeedbackTimer) {
      clearTimeout(loadFeedbackTimer);
      loadFeedbackTimer = null;
    }

    if (loadStatus) {
      loadStatus.textContent = '';
      loadStatus.classList.remove('visible', 'error');
    }

    loadCurrentTargetButton?.classList.remove('load-success');
  };

  const showHoverPreview = (imageUrl) => {
    if (!hoverPreview || !hoverPreviewImage || !imageUrl) return;
    hoverPreviewImage.src = imageUrl;
    hoverPreview.classList.add('visible');
    hoverPreview.setAttribute('aria-hidden', 'false');
  };

  const bindHoverPreview = (container) => {
    if (!container) return;

    container.addEventListener('mouseover', (event) => {
      const previewTarget = event.target.closest('[data-preview-image]');
      if (!previewTarget || !container.contains(previewTarget)) return;
      showHoverPreview(previewTarget.dataset.previewImage);
    });

    container.addEventListener('mouseout', (event) => {
      const previewTarget = event.target.closest('[data-preview-image]');
      if (!previewTarget || !container.contains(previewTarget)) return;

      const related = event.relatedTarget;
      if (related && previewTarget.contains(related)) return;

      hideHoverPreview();
    });
  };

  bindHoverPreview(searchResults);
  bindHoverPreview(cards);

  panel.addEventListener('mouseleave', hideHoverPreview);

  document.addEventListener('native-deck-builder:deck-loaded', (event) => {
    const user = event.detail?.user;
    const deckData = event.detail?.deckData;
    if (!user || !Array.isArray(deckData)) return;

    syncedDecks[user] = syncDeckFromLoadedRows(deckData);

    if (currentLoadTarget === user) {
      deck = syncedDecks[user];
      clearLoadFeedback();
      render();
    }
  });

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
    if (!trimmed) {
      showPreviewPlaceholder('No image');
      return;
    }
    customCardPreviewImage.src = trimmed;
  };

  customCardImageUrl.addEventListener('input', () => {
    updateCustomCardPreview(customCardImageUrl.value);
  });

  customCardPreviewImage.addEventListener('error', () => {
    showPreviewPlaceholder('Invalid image');
  });

  customCardPreviewImage.addEventListener('load', () => {
    showPreviewImage();
  });

  const openCustomCardModal = () => {
    customCardQty.value = '1';
    customCardName.value = '';
    customCardType.value = 'Pokémon';
    customCardImageUrl.value = '';
    customCardError.textContent = '';
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
    try {
      const parsed = new URL(imageUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    } catch {
      customCardError.textContent = 'Image URL must be a valid http or https URL.';
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

    closeCustomCardModal();
    render();
  });

  const render = () => {
    const counts = getDeckCounts(deck);
    const result = validateDeck(deck, DECK_FORMATS.TCG);
    const sortedCards = getSortedDeckCardArray(deck);
    const isOpen = panel.classList.contains('open');

    edgeToggleButton.textContent = isOpen ? '❮' : '❯';
    edgeToggleButton.setAttribute(
      'aria-label',
      isOpen ? 'Collapse deck builder workspace' : 'Expand deck builder workspace'
    );
    edgeToggleButton.title = isOpen
      ? 'Collapse deck builder workspace'
      : 'Expand deck builder workspace';

    targetLabel.textContent = currentLoadTarget === 'self' ? 'P1 Deck' : 'P2 Deck';
    targetMainButton.classList.toggle('native-target-selected', currentLoadTarget === 'self');
    targetAltButton.classList.toggle('native-target-selected', currentLoadTarget === 'opp');

    summary.innerHTML = [
      `Total: <strong>${counts.total}</strong>`,
      `Pokémon: <strong>${counts.pokemon}</strong>`,
      `Trainer: <strong>${counts.trainer}</strong>`,
      `Energy: <strong>${counts.energy}</strong>`,
    ].join(' · ');

    if (validationDot) {
      validationDot.classList.toggle('valid', result.isValid);
      validationDot.classList.toggle('invalid', !result.isValid);
      validationDot.setAttribute('aria-label', result.isValid ? `${result.formatName} deck valid` : (result.errors[0] || 'Deck invalid'));
      validationDot.title = result.isValid ? `${result.formatName} deck valid` : (result.errors[0] || 'Deck invalid');
    }

    renderDeckCards({
      cardsEl: cards,
      sortedCards,
      onRemove: (card) => {
        deck = removeCard(deck, card);
        render();
      },
    });

    renderResults();
  };

  const runSearch = async (options = {}) => {
    const term = (options.term ?? searchInput.value).trim();

    if (!term) {
      currentSearchTerm = '';
      currentResults = [];
      currentRawResults = [];
      currentTotalSummaries = 0;
      searchStatus.textContent = 'Search for a card to begin.';
      render();
      return;
    }

    searchButton.disabled = true;
    showCountSelect.disabled = true;
    searchStatus.textContent = `Searching for “${term}”...`;

    try {
      const searchResponse = await queryCardsByName(term);
      currentSearchTerm = searchResponse.term;
      currentRawResults = searchResponse.results;
      currentTotalSummaries = searchResponse.totalSummaries;
      currentHugeResultSet = searchResponse.isHugeResultSet;
      updateVisibleResults();

      searchStatus.textContent = currentHugeResultSet
        ? `Too many results (${currentTotalSummaries}). Please redefine your search terms.`
        : currentResults.length > 0
          ? `Showing all ${currentResults.length} result(s). Click a card to add it.`
          : 'No matching cards found.';
    } catch (error) {
      currentResults = [];
      currentRawResults = [];
      currentTotalSummaries = 0;
      currentHugeResultSet = false;
      searchStatus.textContent = `Search failed: ${error.message}`;
    } finally {
      searchButton.disabled = false;
      showCountSelect.disabled = false;
      render();
    }
  };

  const togglePanel = () => {
    panel.classList.toggle('open');
    render();
  };

  const closePanel = () => {
    panel.classList.remove('open');
    hideHoverPreview();
    clearLoadFeedback();
    render();
  };

  deckBuilderButton.addEventListener('click', togglePanel);
  edgeToggleButton.addEventListener('click', togglePanel);

  closeButton.addEventListener('click', closePanel);

  targetMainButton.addEventListener('click', () => {
    currentLoadTarget = 'self';
    deck = syncedDecks.self;
    clearLoadFeedback();
    render();
  });

  targetAltButton.addEventListener('click', () => {
    currentLoadTarget = 'opp';
    deck = syncedDecks.opp;
    clearLoadFeedback();
    render();
  });

  loadCurrentTargetButton.addEventListener('click', () => {
    const deckRows = deckToSimRows(deck);
    const targetName = currentLoadTarget === 'self' ? 'P1' : 'P2';

    clearLoadFeedback();

    if (deckRows.length === 0) {
      applyLoadFeedback({
        loadStatusEl: loadStatus,
        loadButtonEl: loadCurrentTargetButton,
        targetName,
        rowCount: 0,
        isError: true,
      });
      return;
    }

    syncedDecks[currentLoadTarget] = deck;
    loadDeckData(currentLoadTarget, deckRows);
    applyLoadFeedback({
      loadStatusEl: loadStatus,
      loadButtonEl: loadCurrentTargetButton,
      targetName,
      rowCount: deckRows.length,
    });
    loadFeedbackTimer = setTimeout(() => {
      clearLoadFeedback();
    }, 2400);
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
      render();
    } catch (error) {
      searchStatus.textContent = `CSV import failed: ${error.message}`;
    } finally {
      importCsvInput.value = '';
    }
  });

  clearButton.addEventListener('click', () => {
    deck = createEmptyDeck();
    syncedDecks[currentLoadTarget] = deck;
    render();
  });

  const rerenderSearchLocally = () => {
    if (!currentSearchTerm) return;
    updateVisibleResults();
    searchStatus.textContent = currentHugeResultSet
      ? `Too many results (${currentTotalSummaries}). Please redefine your search terms.`
      : currentResults.length > 0
        ? `Showing all ${currentResults.length} result(s). Click a card to add it.`
        : 'No matching cards found.';
    renderResults();
  };

  showCountSelect.addEventListener('change', rerenderSearchLocally);
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

  render();
};
