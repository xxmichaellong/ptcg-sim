import {
  createTableCamera,
  projectTableCard,
  projectTablePoint,
  tableCardMatrix,
  unprojectTablePoint,
  type TableCamera,
  type TablePoint,
  type TableViewMode,
} from '@ptcgsim/renderer-contract';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { motionSettings } from '../motion/motion-settings.js';
import { UiButton } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { readingImageStyle } from '../ui/card-artwork.js';
import { depthLabScene, type DepthLabCard } from './depth-lab-scene.js';
import './table-depth-lab.css';

interface Preferences {
  mode: TableViewMode;
  tilt: number;
  strength: number;
  lift: boolean;
  animate: boolean;
}
const defaults: Preferences = {
  mode: 'table',
  tilt: 10,
  strength: 1,
  lift: true,
  animate: true,
};
const storageKey = 'ptcgsim.depth-lab.v1';
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const loadPreferences = (): Preferences => {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(storageKey) ?? 'null'
    );
    if (!value || typeof value !== 'object') return defaults;
    const mode = Reflect.get(value, 'mode');
    const tilt = Reflect.get(value, 'tilt');
    const strength = Reflect.get(value, 'strength');
    return {
      mode: ['flat', 'depth', 'table'].includes(mode) ? mode : defaults.mode,
      tilt:
        typeof tilt === 'number' && Number.isFinite(tilt)
          ? clamp(tilt, 0, 18)
          : defaults.tilt,
      strength:
        typeof strength === 'number' && Number.isFinite(strength)
          ? clamp(strength, 0, 2)
          : defaults.strength,
      lift: Reflect.get(value, 'lift') !== false,
      animate: Reflect.get(value, 'animate') !== false,
    };
  } catch {
    return defaults;
  }
};
const points = (quad: readonly TablePoint[]) =>
  quad.map(({ x, y }) => `${x},${y}`).join(' ');
const zero: TablePoint = { x: 0, y: 0 };

/** Interruptible height easing: a rapid draw starts at the current visible height. */
const useHeight = (target: number, duration: number): number => {
  const [height, setHeight] = useState(target);
  const current = useRef(target);
  useLayoutEffect(() => {
    if (!duration) {
      current.current = target;
      setHeight(target);
      return;
    }
    const from = current.current;
    if (from === target) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      current.current = from + (target - from) * (1 - (1 - progress) ** 3);
      setHeight(current.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return duration ? height : target;
};

interface Drag {
  card: DepthLabCard;
  camera: TableCamera;
  grip: TablePoint;
  original: TablePoint;
  pointer: TablePoint;
  pointerId: number;
  target: HTMLButtonElement;
  lift: number;
  moved: boolean;
}

const Card = ({
  card,
  camera,
  offset,
  lift,
  dragging,
  duration,
  onDown,
  onMove,
  onUp,
  onCancel,
  onInspect,
  onNudge,
}: {
  card: DepthLabCard;
  camera: TableCamera;
  offset: TablePoint;
  lift: number;
  dragging: boolean;
  duration: number;
  onDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    card: DepthLabCard
  ) => void;
  onMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onCancel: () => void;
  onInspect: (card: DepthLabCard) => void;
  onNudge: (card: DepthLabCard, x: number, y: number) => void;
}) => {
  const height = useHeight(card.elevation, dragging ? 0 : duration);
  const elevation = height + lift;
  const bounds = {
    ...card.bounds,
    x: card.bounds.x + offset.x,
    y: card.bounds.y + offset.y,
  };
  const quad = projectTableCard(camera, bounds, elevation, card.turns);
  const bottom = projectTableCard(
    camera,
    bounds,
    card.count === undefined ? elevation - card.thickness : lift,
    card.turns
  );
  const contact = projectTableCard(camera, bounds, 0, card.turns);
  const badge = quad.reduce(
    (lowest, point) => (point.y > lowest.y ? point : lowest),
    quad[0]!
  );
  // At most eight decorative edge bands, regardless of the public pile count.
  const bandCount =
    card.count === undefined || card.thickness === 0
      ? 0
      : Math.min(8, Math.max(0, card.count - 1));
  const bands = Array.from(
    { length: bandCount },
    (_, index) => (index + 1) / (bandCount + 1)
  );
  return (
    <div
      className="depth-lab__object"
      style={{ zIndex: dragging ? 500 + card.layer : card.layer }}
    >
      <svg className="depth-lab__geometry" aria-hidden="true">
        {card.thickness > 0 && (
          <polygon
            points={points(contact)}
            fill="#01080e"
            opacity={dragging ? 0.32 : 0.48}
            filter="url(#depth-lab-shadow)"
            transform={`translate(${elevation * 0.05} ${2 + elevation * 0.1})`}
          />
        )}
        {card.thickness > 0 &&
          [0, 1, 2, 3].map((index) => (
            <polygon
              key={index}
              points={points([
                bottom[index]!,
                bottom[(index + 1) % 4]!,
                quad[(index + 1) % 4]!,
                quad[index]!,
              ])}
              fill={index % 2 ? '#303f51' : '#607184'}
              stroke="#142332"
              strokeWidth="0.55"
            />
          ))}
        {bands.map((fraction) => (
          <polygon
            key={fraction}
            points={points(
              quad.map((point, index) => ({
                x: bottom[index]!.x + (point.x - bottom[index]!.x) * fraction,
                y: bottom[index]!.y + (point.y - bottom[index]!.y) * fraction,
              }))
            )}
            fill="none"
            stroke="#a5b1bc"
            strokeWidth="0.45"
            opacity="0.52"
          />
        ))}
      </svg>
      <button
        type="button"
        className="depth-lab__card"
        aria-label={card.name}
        aria-describedby="depth-lab-help"
        data-card={card.id}
        data-group={card.group}
        data-height={elevation.toFixed(4)}
        data-lift={lift}
        data-dragging={dragging}
        style={{
          width: bounds.width,
          height: bounds.height,
          transform: `matrix3d(${tableCardMatrix(camera, bounds, elevation, card.turns).join(',')})`,
        }}
        onPointerDown={(event) => onDown(event, card)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onLostPointerCapture={onCancel}
        onDoubleClick={() => onInspect(card)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onCancel();
            return;
          }
          const directions: Record<string, TablePoint> = {
            ArrowLeft: { x: -1, y: 0 },
            ArrowRight: { x: 1, y: 0 },
            ArrowUp: { x: 0, y: -1 },
            ArrowDown: { x: 0, y: 1 },
          };
          const direction = directions[event.key];
          if (direction) {
            event.preventDefault();
            onNudge(
              card,
              direction.x * (event.shiftKey ? 20 : 5),
              direction.y * (event.shiftKey ? 20 : 5)
            );
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onInspect(card);
          }
        }}
      >
        <img src={card.image} alt="" draggable={false} />
      </button>
      {card.count !== undefined && (
        <span
          className="depth-lab__count"
          data-count-for={card.id}
          style={{ left: badge.x, top: badge.y }}
        >
          {card.count}
        </span>
      )}
    </div>
  );
};

/** Developer-only, synthetic scene. No session, command, or hidden card state. */
export const TableDepthLab = () => {
  const [preferences, setPreferences] = useState(loadPreferences);
  const [deckCount, setDeckCount] = useState(47);
  const [otherDeckCount, setOtherDeckCount] = useState(47);
  const [drawn, setDrawn] = useState(0);
  const [evolutionLayers, setEvolutionLayers] = useState(3);
  const [specialShapes, setSpecialShapes] = useState(true);
  const [offsets, setOffsets] = useState<Record<string, TablePoint>>({});
  const [dragging, setDragging] = useState<{
    group: string;
    lift: number;
  } | null>(null);
  const [preview, setPreview] = useState<DepthLabCard | null>(null);
  const [size, setSize] = useState({ width: 1100, height: 740 });
  const board = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const store = motionSettings();
  const motion = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const duration =
    preferences.animate && !motion.reduced ? 180 * motion.durationScale : 0;
  const strength = preferences.mode === 'flat' ? 0 : preferences.strength;
  const scene = useMemo(
    () =>
      depthLabScene(size.width, size.height, {
        deckCount,
        otherDeckCount,
        drawn,
        evolutionLayers,
        strength,
        specialShapes,
      }),
    [
      size,
      deckCount,
      otherDeckCount,
      drawn,
      evolutionLayers,
      strength,
      specialShapes,
    ]
  );
  const camera = useMemo(
    () =>
      createTableCamera({
        width: size.width,
        height: scene.fieldHeight,
        mode: preferences.mode,
        tiltDegrees: preferences.tilt,
        maximumElevation: 95,
      }),
    [size.width, scene.fieldHeight, preferences.mode, preferences.tilt]
  );
  const flatCamera = useMemo(
    () => createTableCamera({ ...size, mode: 'flat' }),
    [size]
  );
  const cancelDrag = () => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setOffsets((previous) => ({
      ...previous,
      [current.card.group]: current.original,
    }));
    setDragging(null);
    if (current.target.hasPointerCapture(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
  };
  useLayoutEffect(() => {
    const element = board.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      cancelDrag();
      setOffsets({});
      setSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      /* Site data may be blocked. */
    }
  }, [preferences]);
  useEffect(() => {
    const cancel = () => cancelDrag();
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, []);
  const updatePreferences = (patch: Partial<Preferences>) => {
    cancelDrag();
    setPreferences((previous) => ({ ...previous, ...patch }));
  };
  useEffect(() => {
    cancelDrag();
  }, [motion.reduced]);
  const pointer = (event: ReactPointerEvent): TablePoint => {
    const rect = board.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * size.width) / rect.width,
      y: ((event.clientY - rect.top) * size.height) / rect.height,
    };
  };
  const onDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    card: DepthLabCard
  ) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    const selectedCamera = card.flat ? flatCamera : camera;
    const position = pointer(event);
    const visibleElevation = Number(event.currentTarget.dataset['height']);
    const world = unprojectTablePoint(
      selectedCamera,
      position,
      visibleElevation
    );
    if (!world) return;
    const original = offsets[card.group] ?? zero;
    drag.current = {
      card,
      camera: selectedCamera,
      original,
      grip: {
        x: world.x - card.bounds.x - original.x,
        y: world.y - card.bounds.y - original.y,
      },
      pointer: position,
      pointerId: event.pointerId,
      target: event.currentTarget,
      lift:
        !card.flat && preferences.lift && !motion.reduced ? 40 * strength : 0,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const place = (current: Drag, position: TablePoint, lift: number) => {
    const world = unprojectTablePoint(
      current.camera,
      position,
      current.card.elevation + lift
    );
    if (!world) return;
    setOffsets((previous) => ({
      ...previous,
      [current.card.group]: {
        x: world.x - current.card.bounds.x - current.grip.x,
        y: world.y - current.card.bounds.y - current.grip.y,
      },
    }));
  };
  const onMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const position = pointer(event);
    if (
      !current.moved &&
      Math.hypot(
        position.x - current.pointer.x,
        position.y - current.pointer.y
      ) < 3
    )
      return;
    current.moved = true;
    place(current, position, current.lift);
    setDragging({ group: current.card.group, lift: current.lift });
  };
  const onUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.moved) place(current, pointer(event), 0);
    drag.current = null;
    setDragging(null);
    if (current.target.hasPointerCapture(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
  };
  const inspect = (card: DepthLabCard) => {
    if (!card.back) {
      cancelDrag();
      setPreview(card);
    }
  };
  return (
    <main
      className="depth-lab"
      data-depth-mode={preferences.mode}
      data-height-motion={duration > 0}
    >
      <header className="depth-lab__header">
        <div>
          <span className="depth-lab__eyebrow">TABLE STUDIES · 01</span>
          <h1>A little more tangible.</h1>
          <p>Explore perspective, stack height and cards you can pick up.</p>
        </div>
        <a href="/">Back to simulator</a>
      </header>
      <div className="depth-lab__workspace">
        <section
          className="depth-lab__table"
          aria-label="Experimental card table"
        >
          <div
            className="depth-lab__board"
            ref={board}
            data-testid="depth-board"
          >
            <svg
              className="depth-lab__geometry depth-lab__mat"
              aria-hidden="true"
            >
              <defs>
                <filter
                  id="depth-lab-shadow"
                  x="-30%"
                  y="-30%"
                  width="160%"
                  height="160%"
                >
                  <feGaussianBlur stdDeviation="3" />
                </filter>
                <linearGradient id="depth-lab-felt" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#153a42" />
                  <stop offset="55%" stopColor="#174d54" />
                  <stop offset="100%" stopColor="#102e39" />
                </linearGradient>
              </defs>
              <polygon
                points={points(
                  projectTableCard(
                    camera,
                    {
                      x: 0,
                      y: 0,
                      width: size.width,
                      height: scene.fieldHeight,
                    },
                    0
                  )
                )}
                fill="url(#depth-lab-felt)"
                stroke="#6da8a2"
                strokeOpacity="0.32"
              />
              {scene.zones.map((zone) => (
                <polygon
                  key={zone.id}
                  points={points(projectTableCard(camera, zone.bounds, 0))}
                  fill="none"
                  stroke="#a1ccc6"
                  strokeOpacity="0.16"
                  strokeWidth="1"
                />
              ))}
              {scene.zones
                .filter((zone) =>
                  ['bench', 'active', 'stadium'].includes(zone.kind)
                )
                .map((zone) => {
                  const label = projectTablePoint(camera, {
                    x: zone.bounds.x + 8,
                    y: zone.bounds.y + 15,
                    z: 0,
                  });
                  return (
                    <text
                      key={`${zone.id}-label`}
                      x={label.x}
                      y={label.y}
                      fill="#92b8b8"
                      fontSize="10"
                      letterSpacing="1.5"
                    >
                      {zone.kind.toUpperCase()}
                    </text>
                  );
                })}
            </svg>
            {scene.cards.map((card) => (
              <Card
                key={card.id}
                card={card}
                camera={card.flat ? flatCamera : camera}
                offset={offsets[card.group] ?? zero}
                lift={dragging?.group === card.group ? dragging.lift : 0}
                dragging={dragging?.group === card.group}
                duration={duration}
                onDown={onDown}
                onMove={onMove}
                onUp={onUp}
                onCancel={cancelDrag}
                onInspect={inspect}
                onNudge={(selected, x, y) => {
                  cancelDrag();
                  setOffsets((previous) => ({
                    ...previous,
                    [selected.group]: {
                      x: (previous[selected.group]?.x ?? 0) + x,
                      y: (previous[selected.group]?.y ?? 0) + y,
                    },
                  }));
                }}
              />
            ))}
            <span className="depth-lab__hand-label">
              YOUR HAND · FLAT FOR READING
            </span>
          </div>
          <p id="depth-lab-help" className="depth-lab__help">
            Drag cards to feel the lift. Double-click or press Enter to read.
            Arrow keys move cards; Escape cancels a drag.
          </p>
        </section>
        <aside className="depth-lab__controls" aria-label="Depth controls">
          <span className="depth-lab__eyebrow">DEVELOPER PREVIEW</span>
          <h2>Find the right feeling</h2>
          <fieldset>
            <legend>Table view</legend>
            <div className="depth-lab__modes">
              {(
                [
                  ['flat', 'Flat'],
                  ['depth', 'Raised'],
                  ['table', 'Tabletop'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  type="button"
                  key={mode}
                  aria-pressed={preferences.mode === mode}
                  onClick={() => updatePreferences({ mode })}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="depth-lab__range">
            Camera tilt <output>{preferences.tilt}°</output>
            <input
              aria-label="Camera tilt"
              type="range"
              min="0"
              max="18"
              value={preferences.tilt}
              disabled={preferences.mode !== 'table'}
              onChange={(event) =>
                updatePreferences({ tilt: Number(event.target.value) })
              }
            />
          </label>
          <label className="depth-lab__range">
            Card thickness <output>{preferences.strength.toFixed(1)}×</output>
            <input
              aria-label="Card thickness"
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={preferences.strength}
              disabled={preferences.mode === 'flat'}
              onChange={(event) =>
                updatePreferences({ strength: Number(event.target.value) })
              }
            />
          </label>
          <label className="depth-lab__check">
            <input
              type="checkbox"
              checked={preferences.lift}
              onChange={(event) =>
                updatePreferences({ lift: event.target.checked })
              }
            />
            Lift cards while dragging
          </label>
          <label className="depth-lab__check">
            <input
              type="checkbox"
              checked={preferences.animate}
              onChange={(event) =>
                updatePreferences({ animate: event.target.checked })
              }
            />
            Animate changes in stack height
          </label>
          {motion.reduced && (
            <p className="depth-lab__note" role="status">
              Reduced motion is on. Stack changes are instant and drag lift is
              off.
            </p>
          )}
          <hr />
          <label className="depth-lab__range">
            Your deck <output>{deckCount} cards</output>
            <input
              aria-label="Your deck size"
              type="range"
              min="0"
              max="60"
              value={deckCount}
              onChange={(event) => {
                cancelDrag();
                setDeckCount(Number(event.target.value));
              }}
            />
          </label>
          <label className="depth-lab__range">
            Other deck <output>{otherDeckCount} cards</output>
            <input
              aria-label="Other deck size"
              type="range"
              min="0"
              max="60"
              value={otherDeckCount}
              onChange={(event) => {
                cancelDrag();
                setOtherDeckCount(Number(event.target.value));
              }}
            />
          </label>
          <div className="depth-lab__actions">
            <UiButton
              disabled={deckCount === 0}
              onClick={() => {
                cancelDrag();
                setDeckCount((count) => Math.max(0, count - 1));
                setDrawn((count) => count + 1);
              }}
            >
              Draw one
            </UiButton>
            <UiButton
              onClick={() => {
                cancelDrag();
                setDeckCount(47);
                setOtherDeckCount(47);
                setDrawn(0);
                setOffsets({});
              }}
            >
              Reset scene
            </UiButton>
          </div>
          <label className="depth-lab__range">
            Evolution layers <output>{evolutionLayers}</output>
            <input
              aria-label="Evolution layers"
              type="range"
              min="1"
              max="5"
              value={evolutionLayers}
              onChange={(event) => {
                cancelDrag();
                setEvolutionLayers(Number(event.target.value));
              }}
            />
          </label>
          <label className="depth-lab__check">
            <input
              type="checkbox"
              checked={specialShapes}
              onChange={(event) => {
                cancelDrag();
                setSpecialShapes(event.target.checked);
                setOffsets({});
              }}
            />
            Show BREAK and V-UNION
          </label>
          <p className="depth-lab__note">
            A visual study with sample cards. Settings stay in this browser. Try
            the effect at your normal window size before choosing an angle.
          </p>
        </aside>
      </div>
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        title={preview?.name ?? 'Card'}
        description="Card inspection stays flat and upright."
        className="depth-lab__preview"
        actions={<UiButton onClick={() => setPreview(null)}>Close</UiButton>}
      >
        {preview && (
          <div
            className="depth-lab__preview-art"
            data-landscape={preview.id === 'active-break'}
          >
            <img
              src={preview.image}
              alt={preview.name}
              style={readingImageStyle(preview.id === 'active-break' ? 1 : 0)}
            />
          </div>
        )}
      </Dialog>
    </main>
  );
};
