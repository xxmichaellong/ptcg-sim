/**
 * The table's artwork: the desk and the playmat on it, chosen in Settings.
 * Each look is a set of design tokens in `design/table-art.css`, keyed by
 * `data-table-art` on the page root; a swatch previews one by carrying
 * `data-table-art-swatch` with the same id. The look is the same by Night
 * and by Day, only lit differently (the lamp's tokens are the theme's),
 * except Green felt, which keeps the redesign's walnut night desk and oak
 * day desk.
 */

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
  readonly name: string;
}

export const TABLE_ARTS: readonly TableArt[] = [
  { id: 'cream', name: 'Cream' },
  { id: 'frost', name: 'Frost' },
  { id: 'sakura', name: 'Sakura' },
  { id: 'parchment', name: 'Parchment' },
  { id: 'classic', name: 'Green felt' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'slate', name: 'Slate' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'burgundy', name: 'Burgundy' },
  { id: 'charcoal', name: 'Charcoal' },
];

export const isTableArtId = (value: unknown): value is TableArtId =>
  typeof value === 'string' &&
  (TABLE_ART_IDS as readonly string[]).includes(value);

/** Puts a look on the page root, where every stylesheet reads it. */
export const applyTableArt = (root: HTMLElement, art: TableArtId): void => {
  if (root.dataset.tableArt !== art) root.dataset.tableArt = art;
};
