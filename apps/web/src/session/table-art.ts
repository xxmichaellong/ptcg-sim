/**
 * The table's artwork: the desk and the playmat on it, chosen in Settings.
 * Each look is a set of design tokens in `design/table-art.css`, keyed by
 * `data-table-art` on the page root; a swatch previews one by carrying
 * `data-table-art-swatch` with the same id. The look is the same by Night
 * and by Day, only lit differently (the lamp's tokens are the theme's),
 * except Green felt, which keeps the redesign's walnut night desk and oak
 * day desk.
 */

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export const TABLE_ART_IDS = [
  'cream',
  'frost',
  'sakura',
  'parchment',
  'classic',
  'ocean',
  'slate',
  'midnight',
  'burgundy',
  'charcoal',
] as const;

export type TableArtId = (typeof TABLE_ART_IDS)[number];

/** A cream mat on pale ash, close to v1's white board. */
export const DEFAULT_TABLE_ART: TableArtId = 'cream';

export interface TableArt {
  readonly id: TableArtId;
  /** Its name in Settings, translated where it is shown. */
  readonly name: MessageDescriptor;
}

const look = (id: TableArtId, name: MessageDescriptor): TableArt => ({
  id,
  name,
});

export const TABLE_ARTS: readonly TableArt[] = [
  look('cream', msg({ message: 'Cream', comment: 'A table look: the colour' })),
  look('frost', msg({ message: 'Frost', comment: 'A table look' })),
  look(
    'sakura',
    msg({ message: 'Sakura', comment: 'A table look: cherry blossom pink' })
  ),
  look(
    'parchment',
    msg({ message: 'Parchment', comment: 'A table look: the colour' })
  ),
  look(
    'classic',
    msg({ message: 'Green felt', comment: 'A table look: a green cloth mat' })
  ),
  look('ocean', msg({ message: 'Ocean', comment: 'A table look: the colour' })),
  look('slate', msg({ message: 'Slate', comment: 'A table look: the colour' })),
  look(
    'midnight',
    msg({ message: 'Midnight', comment: 'A table look: midnight blue' })
  ),
  look(
    'burgundy',
    msg({ message: 'Burgundy', comment: 'A table look: the colour' })
  ),
  look(
    'charcoal',
    msg({ message: 'Charcoal', comment: 'A table look: the colour' })
  ),
];

export const isTableArtId = (value: unknown): value is TableArtId =>
  typeof value === 'string' &&
  (TABLE_ART_IDS as readonly string[]).includes(value);

/** Puts a look on the page root, where every stylesheet reads it. */
export const applyTableArt = (root: HTMLElement, art: TableArtId): void => {
  if (root.dataset.tableArt !== art) root.dataset.tableArt = art;
};
