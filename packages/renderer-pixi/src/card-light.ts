import type { CardSceneNode, TablePoint } from '@ptcgsim/renderer-contract';
import type { Graphics } from 'pixi.js';

const colours = [0xe6adcf, 0xe8dba5, 0xa1dbcf, 0x9ebde5, 0xc3aae7];

/** Bounded geometry on one handled face; no full-canvas filters or idle clock. */
export const paintCardLight = (
  graphic: Graphics,
  quad: readonly TablePoint[],
  card: CardSceneNode,
  light: number
): void => {
  graphic.clear();
  const finish = card.concealed || card.tableImageUrl ? 'sheen' : card.finish;
  if (finish === 'matte') return;
  const point = (u: number, v: number) => {
    const top = {
      x: quad[0]!.x * (1 - u) + quad[1]!.x * u,
      y: quad[0]!.y * (1 - u) + quad[1]!.y * u,
    };
    const bottom = {
      x: quad[3]!.x * (1 - u) + quad[2]!.x * u,
      y: quad[3]!.y * (1 - u) + quad[2]!.y * u,
    };
    return [top.x * (1 - v) + bottom.x * v, top.y * (1 - v) + bottom.y * v];
  };
  const strip = (
    left: number,
    right: number,
    top: number,
    bottom: number,
    color: number,
    alpha: number
  ) => {
    graphic
      .poly([
        ...point(left, top),
        ...point(right, top),
        ...point(right, bottom),
        ...point(left, bottom),
      ])
      .fill({ color, alpha });
  };
  const region =
    card.concealed || card.tableImageUrl
      ? 'none'
      : card.presentation?.foilRegion;
  if (region !== 'none' && (finish === 'holo' || finish === 'rainbow')) {
    const art = region === 'artwork' || (!region && finish === 'holo');
    const left = art ? 0.08 : 0;
    const right = art ? 0.92 : 1;
    for (let index = 0; index < 20; index++) {
      const phase = index + light * 10;
      const whole = Math.floor(phase);
      const mix = phase - whole;
      const from = colours[whole % colours.length]!;
      const to = colours[(whole + 1) % colours.length]!;
      const color = [16, 8, 0].reduce(
        (value, shift) =>
          value |
          (Math.round(
            ((from >> shift) & 255) * (1 - mix) + ((to >> shift) & 255) * mix
          ) <<
            shift),
        0
      );
      strip(
        left + ((right - left) * index) / 20,
        left + ((right - left) * (index + 1)) / 20,
        art ? 0.105 : 0,
        art ? 0.525 : 1,
        color,
        0.075
      );
    }
  }
  // Soft specular band follows the pointer without obscuring printed text.
  for (let index = 0; index < 24; index++) {
    const distance = (index + 0.5) / 24 - light;
    strip(
      index / 24,
      (index + 1) / 24,
      0,
      1,
      0xffffff,
      Math.exp(-distance * distance * 38) * 0.12
    );
  }
};
