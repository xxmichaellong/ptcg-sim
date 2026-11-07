import { useCallback, useSyncExternalStore } from 'react';

import {
  preferences,
  type Preference,
  type PreferenceStore,
} from './preference-store.js';

/**
 * One preference's current value. The component re-renders when that
 * preference changes, and only then.
 */
export const usePreference = <T>(
  preference: Preference<T>,
  store: PreferenceStore = preferences()
): T => {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(preference, listener),
    [store, preference]
  );
  const getSnapshot = useCallback(
    () => store.get(preference),
    [store, preference]
  );
  return useSyncExternalStore(subscribe, getSnapshot);
};
