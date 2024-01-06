export * from './initialization/global-variables/global-variables.js' // Initialize all globally accessible variables

import { initializeSocketEventListeners } from './initialization/socket-event-listeners/socket-event-listeners.js'
import { initializeDOMEventListeners } from './initialization/document-event-listeners/initialize-document-event-listeners.js'
import { initializeMutationObservers } from './initialization/mutation-observers/initialize-mutation-observers.js'

initializeSocketEventListeners(); // Initializes all event listeners for socket events
initializeDOMEventListeners(); // Initializes all event listeners for user's actions on html elements and the window
initializeMutationObservers(); // Initializes all mutation observers for user's actions on html elements