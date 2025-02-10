import {
  oppContainerDocument,
  selfContainerDocument,
} from '../../front-end.js';

const scrollToBottom = (element) => {
  element.scrollTop = element.scrollHeight;
};

const handleMutations = (element, mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      scrollToBottom(element);
    }
  });
};

export const initializeBoardObserver = () => {
  const boardElement = selfContainerDocument.getElementById('board');
  const oppBoardElement = oppContainerDocument.getElementById('board');
  // Create MutationObserver instances for both elements
  const boardObserver = new MutationObserver((mutations) =>
    handleMutations(boardElement, mutations)
  );
  const oppBoardObserver = new MutationObserver((mutations) =>
    handleMutations(oppBoardElement, mutations)
  );

  // Configure the observers to watch for changes to child nodes
  const observerConfig = { childList: true };

  // Start observing the target nodes
  boardObserver.observe(boardElement, observerConfig);
  oppBoardObserver.observe(oppBoardElement, observerConfig);
};
