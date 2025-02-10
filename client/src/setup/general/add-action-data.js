const MAX_SIZE = 30;

export const addToActionData = (actionData, counter, newEntry) => {
  actionData.push(newEntry);

  // Check if the array exceeds the maximum size
  if (actionData.length > MAX_SIZE) {
    // Remove elements from the beginning to maintain the maximum size
    actionData = actionData.slice(actionData.length - MAX_SIZE);
    counter--;
  }
};
