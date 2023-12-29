import { chatbox, p1, p2Chatbox } from "../../front-end.js";

export const exportChatboxContent = () => {
    const chatboxContainer = p1[0] ? chatbox : p2Chatbox;
    const pElements = chatboxContainer.querySelectorAll('p');
    let content = '';
  
    pElements.forEach((pElement, index) => {
      const messageContent = pElement.textContent.trim();
      content += `${index + 1}: ${messageContent}\n\n`;
    });
  
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob);
    a.download = 'battle-log.txt';
    a.click();
};

export const clearChatboxContent = () => {
  const chatboxContainer = p1[0] ? chatbox : p2Chatbox;
  chatboxContainer.innerHTML = '';
}
  