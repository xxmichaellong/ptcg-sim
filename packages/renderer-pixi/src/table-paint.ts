import type {
  BoardDepthProjection,
  BoardPreferences,
  BoardScene,
  Rect,
  ZoneSceneNode,
} from '@ptcgsim/renderer-contract';
import { Container, Graphics, Polygon, Text } from 'pixi.js';

interface Ink {
  readonly color: number;
  readonly alpha: number;
}

export interface TablePalette {
  readonly felt: Ink;
  readonly deep: Ink;
  readonly line: Ink;
  readonly strongLine: Ink;
  readonly label: Ink;
  readonly surface: Ink;
  readonly border: Ink;
  readonly text: Ink;
  readonly accent: Ink;
  readonly you: Ink;
  readonly opponent: Ink;
  readonly font: string;
  readonly displayFont: string;
  readonly radius: number;
}

/** Resolve the app's CSS colors through the browser, including OKLCH tokens.
 * This runs on mount/theme changes, never on pointer movement or animation. */
export const readTablePalette = (host: HTMLElement): TablePalette => {
  const css = getComputedStyle(host);
  let context: CanvasRenderingContext2D | null | undefined;
  const ink = (token: string, color: number, alpha = 1): Ink => {
    const value = css.getPropertyValue(token).trim();
    if (!value) return { color, alpha };
    if (context === undefined) {
      const canvas = host.ownerDocument.createElement('canvas');
      canvas.width = canvas.height = 1;
      context = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!context) return { color, alpha };
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = `rgba(${color >> 16},${(color >> 8) & 255},${color & 255},${alpha})`;
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(
      0,
      0,
      1,
      1
    ).data;
    return { color: (r << 16) | (g << 8) | b, alpha: a / 255 };
  };
  return {
    felt: ink('--color-felt', 0x1c3e47),
    deep: ink('--color-felt-deep', 0x122a33),
    line: ink('--color-felt-line', 0xffffff, 0.14),
    strongLine: ink('--color-felt-line-strong', 0xbde4de, 0.3),
    label: ink('--color-felt-label', 0xffffff, 0.62),
    surface: ink('--color-surface-2', 0x1e222c, 0.97),
    border: ink('--color-border-strong', 0xffffff, 0.2),
    text: ink('--color-text', 0xffffff),
    accent: ink('--color-accent', 0x5a6ebc),
    you: ink('--color-you', 0x5a6ebc),
    opponent: ink('--color-opponent', 0xbc5a71),
    font: css.getPropertyValue('--font-ui').trim() || 'sans-serif',
    displayFont: css.getPropertyValue('--font-display').trim() || 'sans-serif',
    radius: parseFloat(css.getPropertyValue('--radius-md')) || 12,
  };
};

const LABELS: Partial<Record<ZoneSceneNode['kind'], string>> = {
  active: 'ACTIVE',
  bench: 'BENCH',
  prizes: 'PRIZES',
  deck: 'DECK',
  discard: 'DISCARD',
  lostZone: 'LOST ZONE',
  stadium: 'STADIUM',
};
const PILES = new Set(['deck', 'discard', 'lostZone']);

/** Rounded corners are projected with the mat, rather than rounding its AABB. */
const outline = (
  bounds: Rect,
  radius: number,
  depth: BoardDepthProjection,
  flat = false
): number[] => {
  const r = Math.min(radius, bounds.width / 2, bounds.height / 2);
  const points: number[] = [];
  const corners = [
    [bounds.x + bounds.width - r, bounds.y + r, -Math.PI / 2],
    [bounds.x + bounds.width - r, bounds.y + bounds.height - r, 0],
    [bounds.x + r, bounds.y + bounds.height - r, Math.PI / 2],
    [bounds.x + r, bounds.y + r, Math.PI],
  ] as const;
  for (const [x, y, start] of corners) {
    for (let step = 0; step <= 6; step++) {
      const angle = start + (step * Math.PI) / 12;
      const p = depth.point(
        { x: x + r * Math.cos(angle), y: y + r * Math.sin(angle) },
        0,
        flat
      );
      points.push(p.x, p.y);
    }
  }
  return points;
};

interface ZoneView {
  readonly graphic: Graphics;
  readonly title: Text;
  descriptor: ZoneSceneNode;
}

/** Retained, renderer-owned table decoration. No ticker or card textures. */
export class PixiTablePaint {
  readonly zones = new Map<string, ZoneView>();
  private readonly backdrop = new Graphics({ eventMode: 'none' });
  private scene: BoardScene | null = null;
  private depth: BoardDepthProjection | null = null;
  private preferences: BoardPreferences | null = null;
  private target: string | null = null;

  constructor(
    private readonly layer: Container,
    private readonly palette: TablePalette,
    private readonly openZone: (id: ZoneSceneNode['id']) => void
  ) {
    this.backdrop.zIndex = -100;
    layer.addChild(this.backdrop);
  }

  sync(
    scene: BoardScene,
    depth: BoardDepthProjection,
    preferences: BoardPreferences,
    target: string | null
  ): void {
    this.scene = scene;
    this.depth = depth;
    this.preferences = preferences;
    this.target = target;
    this.paintBackdrop();
    const ids = new Set(scene.zones.map((zone) => zone.id));
    for (const [id, view] of this.zones) {
      if (ids.has(id)) continue;
      view.graphic.destroy({ children: true });
      this.zones.delete(id);
    }
    for (const descriptor of scene.zones) {
      let view = this.zones.get(descriptor.id);
      if (!view) {
        const graphic = new Graphics({ label: descriptor.id });
        const title = new Text({ eventMode: 'none' });
        graphic.addChild(title);
        view = { graphic, title, descriptor };
        this.zones.set(descriptor.id, view);
        graphic.on('pointertap', (event) => {
          if (event.button === 0 && event.detail === 2)
            this.openZone(descriptor.id);
        });
        this.layer.addChild(graphic);
      }
      view.descriptor = descriptor;
      this.paintZone(view);
    }
  }

  setTarget(target: string | null): void {
    if (target === this.target) return;
    const previous = this.target;
    this.target = target;
    for (const id of [previous, target]) {
      const view = id ? this.zones.get(id) : undefined;
      if (view) this.paintZone(view);
    }
  }

  private paintBackdrop(): void {
    const { scene, depth, palette, backdrop } = this;
    if (!scene || !depth) return;
    backdrop.clear();
    if (depth.enabled) {
      const points = outline(
        {
          x: 0,
          y: 0,
          width: scene.viewport.width,
          height: scene.viewport.height,
        },
        18,
        depth
      );
      backdrop
        .poly(points.map((v, i) => (i % 2 ? v + 5 : v)))
        .stroke({ color: 0x07131b, alpha: 0.22, width: 5 });
      backdrop
        .poly(points)
        // Let the shared lamp-lit felt show through the raised mat. A second
        // opaque gradient would obscure custom table backgrounds and band.
        .fill({ color: palette.deep.color, alpha: 0.22 })
        .stroke({ ...palette.strongLine, width: 1 });
    }
    // Screen-plane seat tint and centre seam match the unprojected controls.
    for (const frame of scene.layout.players) {
      if (frame.hidden) continue;
      const { bounds, physicalSide, side } = frame;
      const color =
        side === 'local' ? palette.you.color : palette.opponent.color;
      const height = bounds.height * 0.2;
      for (let step = 0; step < 24; step++) {
        const y =
          physicalSide === 'lower'
            ? bounds.y + bounds.height - ((step + 1) * height) / 24
            : bounds.y + (step * height) / 24;
        backdrop
          .rect(bounds.x, y, bounds.width, height / 24)
          .fill({ color, alpha: 0.15 * (1 - step / 24) ** 2 });
      }
      if (physicalSide === 'lower')
        backdrop
          .moveTo(bounds.x, bounds.y)
          .lineTo(bounds.x + bounds.width, bounds.y)
          .stroke({ ...palette.strongLine, width: 1 });
    }
  }

  private paintZone({ graphic, title, descriptor: zone }: ZoneView): void {
    const { depth, preferences, palette } = this;
    if (!depth || !preferences) return;
    const flat = ['hand', 'inspection', 'attachmentResolution'].includes(
      zone.kind
    );
    const points = outline(zone.bounds, palette.radius, depth, flat);
    const name = LABELS[zone.kind];
    const selected = zone.id === this.target;
    graphic.clear();
    if (selected || (name && preferences.showZoneOutlines)) {
      graphic
        .poly(points)
        .fill({
          color: selected ? palette.accent.color : 0xffffff,
          alpha: selected ? 0.22 : 0.018,
        })
        .stroke({
          ...(selected ? palette.accent : palette.line),
          ...(preferences.highContrast ? { alpha: 0.65 } : {}),
          width: selected ? 2 : 1.5,
        });
    }
    graphic.hitArea = new Polygon(points);
    graphic.zIndex = zone.zIndex;
    graphic.eventMode = zone.interactive ? 'static' : 'none';
    graphic.cursor = zone.interactive ? 'pointer' : 'default';
    graphic.accessible = zone.interactive;
    graphic.accessibleTitle = `${zone.label}, ${zone.count} cards`;
    title.visible = Boolean(name && preferences.showZoneOutlines);
    if (!name) return;
    const pile = PILES.has(zone.kind);
    const centered = pile || zone.kind === 'stadium';
    const opponent = zone.side === 'opponent';
    const top = pile ? opponent : centered ? false : !opponent;
    const x = centered
      ? zone.bounds.width / 2 + (pile ? (opponent ? 6 : -6) : 0)
      : opponent
        ? zone.bounds.width - 8
        : 8;
    const y = top
      ? centered
        ? 8
        : 6
      : zone.bounds.height - (centered ? 8 : 6);
    const anchor = depth.point({ x: zone.bounds.x + x, y: zone.bounds.y + y });
    const left = depth.point({ x: zone.bounds.x, y: zone.bounds.y + y });
    const right = depth.point({
      x: zone.bounds.x + zone.bounds.width,
      y: zone.bounds.y + y,
    });
    title.text = name;
    Object.assign(title.style, {
      fontFamily: palette.font,
      fontSize: centered ? 9 : 10,
      fontWeight: '600',
      letterSpacing: centered ? 1.08 : 1.2,
      fill: palette.label.color,
      wordWrap: centered,
      wordWrapWidth: Math.max(20, zone.bounds.width - 20),
      align: centered ? 'center' : opponent ? 'right' : 'left',
    });
    title.alpha = preferences.highContrast ? 1 : palette.label.alpha;
    title.anchor.set(centered ? 0.5 : opponent ? 1 : 0, top ? 0 : 1);
    title.position.set(anchor.x, anchor.y);
    title.scale.set((right.x - left.x) / zone.bounds.width);
    title.resolution = this.scene?.viewport.devicePixelRatio ?? 1;
  }

  destroy(): void {
    for (const view of this.zones.values())
      view.graphic.destroy({ children: true });
    this.zones.clear();
    this.backdrop.destroy();
  }
}
