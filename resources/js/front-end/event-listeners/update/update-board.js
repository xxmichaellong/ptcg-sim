import { board_html, oppBoard_html } from "../../front-end.js";

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

// Create MutationObserver instances for both elements
const boardObserver = new MutationObserver((mutations) => handleMutations(board_html, mutations));
const oppBoardObserver = new MutationObserver((mutations) => handleMutations(oppBoard_html, mutations));

// Configure the observers to watch for changes to child nodes
const observerConfig = { childList: true };

// Start observing the target nodes
boardObserver.observe(board_html, observerConfig);
oppBoardObserver.observe(oppBoard_html, observerConfig);