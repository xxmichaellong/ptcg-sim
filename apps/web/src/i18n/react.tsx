import { i18n } from '@lingui/core';
import { TransNoContext, type TransProps } from '@lingui/react/server';
import { useMemo, useSyncExternalStore } from 'react';

/**
 * What the `Trans` and `useLingui` macros compile to (lingui.config.ts
 * points them here). Lingui's own versions read an `I18nProvider`; these
 * read the one `i18n` the page has, so no component, test or portal needs a
 * provider above it, and any component that shows text re-renders when the
 * language changes, memoized or not.
 */

// Counted before any component hears of the change: this listener is
// registered first, so a re-render always sees the new count.
let changes = 0;
i18n.on('change', () => {
  changes += 1;
});
const subscribe = (listener: () => void) => i18n.on('change', listener);
const snapshot = () => changes;

export const useLingui = () => {
  const change = useSyncExternalStore(subscribe, snapshot, snapshot);
  // A new `_` for each change, so memos keyed on it recompute.
  return useMemo(() => ({ i18n, _: i18n._.bind(i18n), change }), [change]);
};

export const Trans = (props: TransProps) => {
  const lingui = useLingui();
  return <TransNoContext {...props} lingui={lingui} />;
};
