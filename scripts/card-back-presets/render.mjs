// Renders the shipped card-back presets (ADR-041 §7) from the standard back.
//
//   node scripts/card-back-presets/render.mjs [--preview <dir>]
//
// Each preset is drawn region by region from the standard artwork, not
// tinted: the frame, the field and its brush strokes, the swirl, and the
// Poké Ball (its two halves, band and button) each take their own colors
// from palettes.json, and each ball its own markings. The WebPs are written
// to apps/web/public/v2/assets/backs/ named by their content; the list for
// card-back-presets.ts is printed. --preview also writes PNGs to a folder.
//
// sharp is not a dependency of its own here: it comes with miniflare, under
// apps/server's wrangler, so it is loaded from there.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const fromServer = createRequire(join(root, 'apps/server/package.json'));
const fromWrangler = createRequire(fromServer.resolve('wrangler'));
const fromMiniflare = createRequire(fromWrangler.resolve('miniflare'));
const sharp = fromMiniflare('sharp');

const BACKS = join(root, 'apps/web/public/v2/assets/backs');
const SOURCE = join(BACKS, 'standard.6261f7f137.webp');
const palettes = JSON.parse(readFileSync(join(here, 'palettes.json'), 'utf8'));
const previewAt = process.argv.indexOf('--preview');
const preview = previewAt > 0 ? process.argv[previewAt + 1] : undefined;
if (preview) mkdirSync(preview, { recursive: true });

const { data, info } = await sharp(SOURCE)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const lum = new Float32Array(W * H);
const alpha = new Uint8Array(W * H);
for (let k = 0; k < W * H; k++) {
  lum[k] =
    0.2126 * data[k * 4] + 0.7152 * data[k * 4 + 1] + 0.0722 * data[k * 4 + 2];
  alpha[k] = data[k * 4 + 3];
}

// The artwork's geometry, measured: the field inside the frame, and the
// ball's circle.
const FX0 = 19;
const FX1 = 483;
const FY0 = 18;
let FY1 = H - 19;
for (let y = H - 1; y > H - 40; y--) {
  if (lum[y * W + 252] < 120) {
    FY1 = y;
    break;
  }
}
const CX = 251.5;
const CY = 351.5;
const R = 150;
const inCircle = (x, y) => (x - CX) ** 2 + (y - CY) ** 2 < (R + 0.5) ** 2;

// The ball's light parts: 1 its top half, 2 its bottom half, 3 the button's
// crescent. Spread 3px so the dark band and soft edges know the nearest.
const label = new Uint8Array(W * H);
const flood = (sx, sy, id) => {
  const stack = [sx + sy * W];
  while (stack.length > 0) {
    const k = stack.pop();
    const x = k % W;
    const y = Math.floor(k / W);
    if (label[k] || !inCircle(x, y) || lum[k] < 100) continue;
    label[k] = id;
    stack.push(k + 1, k - 1, k + W, k - W);
  }
};
flood(252, 260, 1);
flood(300, 470, 2);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (!label[k] && inCircle(x, y) && lum[k] >= 100) flood(x, y, 3);
  }
}
let near = label.slice();
for (let pass = 0; pass < 3; pass++) {
  const next = near.slice();
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      if (next[k]) continue;
      const n = near[k - 1] || near[k + 1] || near[k - W] || near[k + W];
      if (n && inCircle(x, y)) next[k] = n;
    }
  }
  near = next;
}

// The ball as a sphere: its pole fitted to the band (its equator, seen from
// above), markings laid out from the side facing the viewer.
const POLE = [0.041, -0.95, 0.309];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalAt = (x, y) => {
  const u = (x - CX) / R;
  const v = (y - CY) / R;
  return [u, v, Math.sqrt(Math.max(0, 1 - u * u - v * v))];
};
const toward = [0, 0, 1];
const frontRaw = toward.map((c, i) => c - dot(toward, POLE) * POLE[i]);
const FRONT = frontRaw.map((c) => c / Math.hypot(...frontRaw));
const EAST = [
  POLE[1] * FRONT[2] - POLE[2] * FRONT[1],
  POLE[2] * FRONT[0] - POLE[0] * FRONT[2],
  POLE[0] * FRONT[1] - POLE[1] * FRONT[0],
];
const sphereAt = (x, y) => {
  const n = normalAt(x, y);
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, dot(n, POLE)))),
    lon: Math.atan2(dot(n, EAST), dot(n, FRONT)),
  };
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const add = (a, b, t) => [a[0] + b[0] * t, a[1] + b[1] * t, a[2] + b[2] * t];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (e0, e1, v) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** 1 inside [a, b], softened over about a pixel. */
const within = (v, a, b, soft = 0.012) =>
  clamp01((v - a) / soft + 0.5) * clamp01((b - v) / soft + 0.5);
const hashAt = (x, y, seed) => {
  let h = (x * 374761393 + y * 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const valueNoise = (x, y) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const s = (t) => t * t * (3 - 2 * t);
  const xf = s(x - xi);
  const yf = s(y - yi);
  const a = hashAt(xi, yi, 0x2545f491);
  const b = hashAt(xi + 1, yi, 0x2545f491);
  const c = hashAt(xi, yi + 1, 0x2545f491);
  const d = hashAt(xi + 1, yi + 1, 0x2545f491);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
};

/** A ball's markings on its top half: [color, coverage], or null. */
const markingAt = (motif, marking, x, y) => {
  if (!motif) return null;
  const { lat, lon } = sphereAt(x, y);
  const side = Math.abs(lon);
  switch (motif) {
    case 'great':
      // A red patch either side of the top.
      return [marking, within(side, 0.44, 0.88) * within(lat, 0.12, 0.8)];
    case 'ultra': {
      // Yellow up both sides and over the top.
      const sides = within(side, 0.34, 0.64) * within(lat, 0.06, 0.86);
      const over = within(lat, 0.6, 0.86) * within(side, -1, 0.64);
      return [marking, Math.max(sides, over)];
    }
    case 'master': {
      // A raised pink boss either side.
      const d = Math.hypot(side - 0.62, lat - 0.44);
      const boss = within(d, -1, 0.2, 0.02);
      return [mix(marking, [255, 255, 255], 0.28 * (1 - d / 0.2) * boss), boss];
    }
    case 'net': {
      // A net over the top.
      const g = 0.4;
      const m = ((lon % g) + g) % g;
      const alongLon = Math.min(m, g - m);
      const alongLat = Math.min(Math.abs(lat - 0.32), Math.abs(lat - 0.68));
      const line = Math.max(
        within(alongLon, -1, 0.03, 0.02),
        within(alongLat, -1, 0.03, 0.02)
      );
      return [marking, line * within(lat, 0.06, 1.6) * 0.92];
    }
    case 'safari': {
      // Camouflage blots.
      const n =
        valueNoise(lon * 4.2 + 3.1, lat * 4.2 + 7.7) * 0.65 +
        valueNoise(lon * 9 + 11, lat * 9 + 2) * 0.35;
      return [marking, clamp01((n - 0.52) / 0.05)];
    }
    default:
      throw new Error(`Unknown marking: ${motif}`);
  }
};

// The swirl strokes, blurred: a soft glow under them.
const swirlMask = Buffer.alloc(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const k = y * W + x;
    const field = x >= FX0 && x <= FX1 && y >= FY0 && y <= FY1;
    swirlMask[k] =
      field && !inCircle(x, y) ? Math.round(255 * smooth(100, 160, lum[k])) : 0;
  }
}
// One byte a pixel: sharp would hand back sRGB's three otherwise.
const { data: glow, info: glowInfo } = await sharp(swirlMask, {
  raw: { width: W, height: H, channels: 1 },
})
  .blur(7)
  .toColourspace('b-w')
  .raw()
  .toBuffer({ resolveWithObject: true });
if (glowInfo.channels !== 1 || glow.length !== W * H) {
  throw new Error(
    `The swirl's glow came back with ${glowInfo.channels} channels`
  );
}

// Light from the upper left, for the ball's roundness.
const LIGHT = [-0.42, -0.55, 0.72];
const LIGHT_LENGTH = Math.hypot(...LIGHT);

const listed = [];
for (const [name, palette] of Object.entries(palettes)) {
  const c = Object.fromEntries(
    Object.entries(palette)
      .filter(([key, value]) => key !== 'motif' && typeof value === 'string')
      .map(([key, value]) => [key, hex(value)])
  );
  const fieldAt = (x, y, l) => {
    // Deep at the edges, lit behind the ball; the brush strokes lift it,
    // and it sits a little into the frame.
    const d = Math.hypot((x - CX) / (W * 0.62), (y - CY) / (H * 0.55));
    let base = mix(c.glowField, c.deep, smooth(0.15, 1.05, d));
    base = mix(base, c.stroke, clamp01(l / 100) * 0.55);
    const edge = Math.min(x - FX0, FX1 - x, y - FY0, FY1 - y);
    return scale(base, 1 - 0.32 * (1 - smooth(0, 9, edge)));
  };
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      const l = lum[k];
      let col;
      if (!(x >= FX0 && x <= FX1 && y >= FY0 && y <= FY1)) {
        // The frame: a diagonal sheen, a keyline along its inner edge, the
        // outer edge a little darker.
        col = mix(c.frameA, c.frameB, clamp01((x / W) * 0.45 + (y / H) * 0.55));
        const sheen = Math.exp(
          -(
            ((x - W * 0.25) / (W * 0.5)) ** 2 +
            ((y - H * 0.1) / (H * 0.35)) ** 2
          )
        );
        col = add(col, [255, 255, 255], 0.06 * sheen);
        const fromField =
          (x < FX0 ? FX0 - x : x > FX1 ? x - FX1 : 0) +
          (y < FY0 ? FY0 - y : y > FY1 ? y - FY1 : 0);
        if (fromField > 1 && fromField <= 3) col = mix(col, c.keyline, 0.9);
        const fromEdge = Math.min(x, y, W - 1 - x, H - 1 - y);
        if (fromEdge < 2) col = mix(col, c.edge, 0.55 - fromEdge * 0.2);
        col = add(
          col,
          [255, 255, 255],
          (hashAt(x, y, 0x5bd1e995) - 0.5) * 0.035
        );
      } else if (inCircle(x, y)) {
        const part = near[k] || label[k];
        let shell =
          part === 1
            ? c.top
            : part === 2
              ? c.bottom
              : part === 3
                ? c.crescent
                : c.band;
        if (part === 1) {
          const marked = markingAt(palette.motif, c.marking, x, y);
          if (marked) shell = mix(shell, marked[0], marked[1]);
        }
        if (part === 1 || part === 2) {
          const n = normalAt(x, y);
          const lit = clamp01(dot(n, LIGHT) / LIGHT_LENGTH);
          shell = scale(shell, 0.8 + 0.2 * lit);
          shell = add(shell, [255, 255, 255], lit ** 22 * 0.16);
          // The print's grain.
          shell = add(shell, [255, 255, 255], ((l - 158) / 255) * 0.35);
        }
        const dist = Math.hypot(x - CX, y - CY);
        const dark = dist > R - 2 ? fieldAt(x, y, l) : c.band;
        col = mix(dark, shell, smooth(70, 150, l));
      } else {
        col = fieldAt(x, y, l);
        // The ball's shadow, down and to the right.
        const fromBall = Math.hypot(x - CX - 5, y - CY - 9) - R;
        col = scale(col, 1 - 0.38 * (1 - smooth(0, 22, fromBall)));
        col = add(col, c.swirlGlow, (glow[k] / 255) * 0.35);
        col = mix(col, c.swirl, smooth(100, 160, l));
      }
      for (let i = 0; i < 3; i++) {
        out[k * 4 + i] = Math.max(0, Math.min(255, Math.round(col[i])));
      }
      out[k * 4 + 3] = alpha[k];
    }
  }
  const image = sharp(out, { raw: { width: W, height: H, channels: 4 } });
  if (preview)
    await image
      .clone()
      .png()
      .toFile(join(preview, `${name}.png`));
  const webp = await image
    .webp({ quality: 88, alphaQuality: 100, effort: 6, smartSubsample: true })
    .toBuffer();
  const file = `${name}.${createHash('sha256').update(webp).digest('hex').slice(0, 10)}.webp`;
  writeFileSync(join(BACKS, file), webp);
  listed.push(`  { id: '${name}', file: '${file}' },`);
}
process.stdout.write(`${listed.join('\n')}\n`);
