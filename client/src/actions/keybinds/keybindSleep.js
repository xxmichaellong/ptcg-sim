import { mouseClick } from '../../front-end.js';

export let areKeybindsSleeping = false;

// Counter to track overlapping sleep requests
let sleepRequestCount = 0;

// Duration in milliseconds to sleep keybinds
const keybindsSleepDuration = 350;

/**
 * Temporarily disables keybinds for a short duration when a card is being selected.
 * Uses a counter to handle overlapping calls, ensuring keybinds are only re-enabled
 * when all sleep requests have completed.
 *
 * @returns {Promise<void>} A promise that resolves when the sleep operation completes
 */
export async function startKeybindsSleep() {
  // Only sleep keybinds if a card is being selected
  if (!mouseClick.selectingCard) {
    return;
  }

  // Increment the counter and set the sleeping state
  sleepRequestCount++;
  areKeybindsSleeping = true;

  // Wait for the specified duration
  await new Promise((resolve) => setTimeout(resolve, keybindsSleepDuration));

  // Decrement the counter and check if we should wake up
  sleepRequestCount--;
  if (sleepRequestCount === 0) {
    areKeybindsSleeping = false;
  }
}
