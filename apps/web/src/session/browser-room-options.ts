import type { ActivityFeedItem } from '../presentation/ActivityFeedModel.js';
import { presentationText } from '../presentation/presentation-message.js';

/** The Log as text, worded in the page's language. */
export const serializeBattleLog = (
  items: readonly Pick<ActivityFeedItem, 'message'>[]
): string =>
  items
    .map(
      (item, index) =>
        `${index + 1}: ${presentationText(item.message).trim()}\n\n`
    )
    .join('');

/** Downloads recipient-safe presentation text without retaining an object URL. */
export const downloadBrowserTextFile = (
  filename: string,
  contents: string
): boolean => {
  const urlApi = globalThis.URL;
  const createObjectURL = urlApi?.createObjectURL;
  const revokeObjectURL = urlApi?.revokeObjectURL;
  if (
    !globalThis.document ||
    typeof createObjectURL !== 'function' ||
    typeof revokeObjectURL !== 'function'
  ) {
    return false;
  }

  let objectUrl: string | undefined;
  try {
    objectUrl = createObjectURL.call(
      urlApi,
      new Blob([contents], { type: 'text/plain' })
    );
    const link = globalThis.document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.click();
    return true;
  } catch {
    return false;
  } finally {
    if (objectUrl !== undefined) revokeObjectURL.call(urlApi, objectUrl);
  }
};
