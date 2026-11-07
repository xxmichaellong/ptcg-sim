import type { Rect } from './model.js';

/** Compact handles overlap only the host's lower edge, never widen its row. */
export const compactAttachmentSlots = (
  host: Rect,
  count: number,
  far: boolean
): readonly { readonly bounds: Rect; readonly overflow?: number }[] => {
  if (count < 1) return [];
  const gap = 3;
  const size = Math.min(26, Math.max(14, host.width * 0.21));
  const columns = Math.max(1, Math.floor((host.width + gap) / (size + gap)));
  const capacity = Math.max(2, columns * 2);
  const shown = Math.min(count, capacity);
  const rows = Math.ceil(shown / columns);
  return Array.from({ length: shown }, (_, index) => {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, shown - row * columns);
    const column = far ? inRow - 1 - (index % columns) : index % columns;
    return {
      bounds: {
        x:
          host.x +
          (host.width - inRow * size - (inRow - 1) * gap) / 2 +
          column * (size + gap),
        y: far
          ? host.y + size * 0.2 + (rows - 1 - row) * (size + gap)
          : host.y + host.height - size * 1.2 - (rows - 1 - row) * (size + gap),
        width: size,
        height: size,
      },
      ...(count > capacity && index === capacity - 1
        ? { overflow: count - capacity + 1 }
        : {}),
    };
  });
};

/** Only unambiguous Basic Energy names become type symbols; other cards keep art. */
export const basicAttachmentEnergyIndex = (
  name: string
): number | undefined => {
  const match =
    /^(?:(basic)\s+)?(?:(grass|fire|water|lightning|psychic|fighting|darkness|dark|metal|fairy)|\{([grwlpfdmy])\}|([grwlpfdmy]))\s+energy(?:\s+energy)?(?:\s+null)?$/iu.exec(
      name.trim()
    );
  if (!match || (match[4] && !match[1])) return undefined;
  const word = match[2]?.toLowerCase();
  const symbol = (match[3] ?? match[4])?.toLowerCase();
  const index = symbol
    ? 'grwlpfdmy'.indexOf(symbol)
    : [
        'grass',
        'fire',
        'water',
        'lightning',
        'psychic',
        'fighting',
        'darkness',
        'metal',
        'fairy',
      ].indexOf(word === 'dark' ? 'darkness' : (word ?? ''));
  // Older Special Darkness and Metal Energy share the Basic cards' names.
  if ((index === 6 || index === 7) && !match[1]) return undefined;
  return index < 0 ? undefined : index;
};
