import {
  composeCardArtwork,
  createEmptyBoardView,
  createTableLayoutSnapshot,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  fitCardComposition,
  tablePileHeight,
  type Rect,
} from '@ptcgsim/renderer-contract';

export interface DepthLabCard {
  readonly id: string;
  readonly group: string;
  readonly name: string;
  readonly image: string;
  readonly bounds: Rect;
  readonly turns: number;
  readonly elevation: number;
  readonly thickness: number;
  readonly layer: number;
  readonly back?: boolean;
  readonly count?: number;
  readonly flat?: boolean;
}

const back = '/v2/assets/cardback.png';
const art = (id: string) => `https://assets.tcgdex.net/en/${id}/high.webp`;
export const DEPTH_LAB_ART = {
  greninja: art('xy/xy9/40'),
  break: art('xy/xy9/41'),
  lugia: art('hgss/hgss1/113'),
  tool: art('xy/xy4/97'),
  union: [159, 160, 161, 162].map((number) => art(`swsh/swshp/SWSH${number}`)),
};

const portrait = (box: Rect, scale = 1): Rect => {
  const height = Math.min(box.height, (box.width * 88) / 63) * scale;
  const width = (height * 63) / 88;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
};

/** Synthetic public artwork only. The lab never opens a room or reads a deck. */
export const depthLabScene = (
  width: number,
  height: number,
  options: {
    readonly deckCount: number;
    readonly otherDeckCount: number;
    readonly drawn: number;
    readonly evolutionLayers: number;
    readonly strength: number;
    readonly specialShapes: boolean;
  }
) => {
  const empty = createEmptyBoardView();
  const fieldHeight = Math.max(380, height - 125);
  const layout = createTableLayoutSnapshot({
    viewport: { width, height: fieldHeight, devicePixelRatio: 1 },
    playerIds: [empty.playerOrder[0]!, empty.playerOrder[1]!],
    bottomPlayerId: empty.playerOrder[0]!,
    shellMode: 'fullscreen',
    geometryVersion: 2,
    vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
  });
  const cards: DepthLabCard[] = [];
  const zones = layout.players.flatMap((player) =>
    player.regions
      .filter((region) => !['hand', 'board'].includes(region.kind))
      .map((region) => ({
        id: region.id,
        kind: region.kind,
        side: player.side,
        bounds: region.physicalDeclaredBounds,
      }))
  );
  for (const player of layout.players) {
    const local = player.side === 'local';
    const region = (kind: string) =>
      player.regions.find((item) => item.kind === kind)!.physicalDeclaredBounds;
    const turns = local ? 0 : 2;
    for (const kind of ['deck', 'discard'] as const) {
      const count =
        kind === 'deck'
          ? local
            ? options.deckCount
            : options.otherDeckCount
          : local
            ? 9
            : 24;
      if (!count) continue;
      const bounds = portrait(region(kind), 0.9);
      const elevation = tablePileHeight(count, bounds.width, options.strength);
      cards.push({
        id: `${player.side}-${kind}`,
        group: `${player.side}-${kind}`,
        name: `${local ? 'Your' : 'Other'} ${kind}`,
        image: kind === 'deck' ? back : DEPTH_LAB_ART.tool,
        bounds,
        turns,
        elevation,
        thickness: elevation,
        layer: 20,
        back: kind === 'deck',
        count,
      });
    }
    const active = region('active');
    const bounds = portrait(active, 0.88);
    if (local && options.specialShapes) {
      const composition = fitCardComposition(
        composeCardArtwork([
          { id: 'active-base' },
          {
            id: 'active-break',
            presentation: { readingQuarterTurns: 1, overlay: 'upper-half' },
          },
        ])!,
        {
          x: active.x + 6,
          y: active.y + 4,
          width: active.width - 12,
          height: active.height - 8,
        }
      );
      for (const [index, part] of composition.cards.entries()) {
        const thickness = tablePileHeight(
          1,
          part.bounds.width,
          options.strength
        );
        cards.push({
          id: part.id,
          group: 'local-active',
          name: index ? 'Greninja BREAK' : 'Greninja',
          image: index ? DEPTH_LAB_ART.break : DEPTH_LAB_ART.greninja,
          bounds: part.bounds,
          turns: part.rotationQuarterTurns,
          elevation: thickness * (index + 1),
          thickness,
          layer: 40 + index,
        });
      }
    } else {
      for (let layer = 0; layer < options.evolutionLayers; layer++) {
        const thickness = tablePileHeight(1, bounds.width, options.strength);
        cards.push({
          id: `${player.side}-active-${layer}`,
          group: `${player.side}-active`,
          name: 'Greninja',
          image: DEPTH_LAB_ART.greninja,
          bounds: {
            ...bounds,
            y: bounds.y - (options.evolutionLayers - layer - 1) * 4,
          },
          turns,
          elevation: thickness * (layer + 1),
          thickness,
          layer: 40 + layer,
        });
      }
    }
    const bench = region('bench');
    const cell = {
      x: bench.x + bench.width * 0.15,
      y: bench.y + 4,
      width: bench.width * 0.28,
      height: bench.height - 8,
    };
    if (local && options.specialShapes) {
      const composition = fitCardComposition(
        composeCardArtwork(
          [0, 1, 2, 3].map((part) => ({
            id: `union-${part}`,
            presentation: {
              readingQuarterTurns: 0,
              join: {
                key: 'lab-union',
                columns: 2,
                rows: 2,
                part: part as 0 | 1 | 2 | 3,
              },
            },
          }))
        )!,
        cell
      );
      for (const [index, part] of composition.cards.entries()) {
        const thickness = tablePileHeight(
          1,
          part.bounds.width,
          options.strength
        );
        cards.push({
          id: part.id,
          group: 'union',
          name: `Mewtwo V-UNION piece ${index + 1}`,
          image: DEPTH_LAB_ART.union[index]!,
          bounds: part.bounds,
          turns: 0,
          elevation: thickness,
          thickness,
          layer: 30,
        });
      }
    } else {
      const card = portrait(cell, 0.96);
      const thickness = tablePileHeight(1, card.width, options.strength);
      cards.push({
        id: `${player.side}-bench-a`,
        group: `${player.side}-bench-a`,
        name: 'Greninja',
        image: DEPTH_LAB_ART.greninja,
        bounds: card,
        turns,
        elevation: thickness,
        thickness,
        layer: 30,
      });
    }
    const second = portrait({ ...cell, x: bench.x + bench.width * 0.58 }, 0.96);
    const thickness = tablePileHeight(1, second.width, options.strength);
    cards.push({
      id: `${player.side}-bench-b`,
      group: `${player.side}-bench-b`,
      name: 'Head Ringer',
      image: DEPTH_LAB_ART.tool,
      bounds: second,
      turns,
      elevation: thickness,
      thickness,
      layer: 30,
    });
    const prizes = region('prizes');
    for (let index = 0; index < 6; index++) {
      const card = portrait(
        {
          x: prizes.x + ((index % 2) * prizes.width) / 2,
          y: prizes.y + (Math.floor(index / 2) * prizes.height) / 3,
          width: prizes.width / 2,
          height: prizes.height / 3,
        },
        0.86
      );
      const thickness = tablePileHeight(1, card.width, options.strength);
      cards.push({
        id: `${player.side}-prize-${index}`,
        group: `${player.side}-prize-${index}`,
        name: `${local ? 'Your' : 'Other'} Prize ${index + 1}`,
        image: back,
        bounds: card,
        turns,
        elevation: thickness,
        thickness,
        layer: 10,
        back: true,
      });
    }
  }
  const handCount = Math.min(7, 3 + options.drawn);
  const handWidth = Math.min(78, (width - 50) / handCount - 8);
  for (let index = 0; index < handCount; index++) {
    cards.push({
      id: `hand-${index}`,
      group: `hand-${index}`,
      name: 'Head Ringer in hand',
      image: DEPTH_LAB_ART.tool,
      bounds: {
        x: (width - handCount * (handWidth + 8)) / 2 + index * (handWidth + 8),
        y: height - 116,
        width: handWidth,
        height: (handWidth * 88) / 63,
      },
      turns: 0,
      elevation: 0,
      thickness: 0,
      layer: 300,
      flat: true,
    });
  }
  return { cards, zones, fieldHeight };
};
