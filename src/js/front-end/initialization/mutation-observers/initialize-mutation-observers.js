import { initializeBenchObserver } from './bench-observer.js'
import { initializeBoardObserver } from './board-observer.js'
import { initializeHandObserver } from './hand-observer.js'
import { initializePrizesObserver } from './prizes-observer.js'
import { initializeStadiumObserver } from './stadium-observer.js'

export const initializeMutationObservers = () => {
    initializeBenchObserver();
    initializeBoardObserver();
    initializeHandObserver();
    initializePrizesObserver();
    initializeStadiumObserver();
}