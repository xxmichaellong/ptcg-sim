import { describe, expect, it } from 'vitest';

import {
  damageCounterBand,
  isLegacyMarkerPresentation,
  legacyMarkerAppearance,
  legacyMarkerCssColor,
  legacyMarkerPackedColor,
  markerFace,
  markerLabelFontSizePx,
  specialConditionKind,
  type LegacyMarkerColor,
} from './marker-presentation.js';
import type { MarkerSceneNode } from './model.js';

const bounds = { x: 0, y: 0, width: 30, height: 30 };

const marker = (
  overrides: Partial<Pick<MarkerSceneNode, 'kind' | 'value' | 'side'>> = {}
): Pick<MarkerSceneNode, 'kind' | 'value' | 'side' | 'bounds'> => ({
  kind: 'damage',
  value: '130',
  side: 'local',
  bounds,
  ...overrides,
});

/** WCAG 2 relative luminance and contrast ratio. */
const luminance = ({ r, g, b }: LegacyMarkerColor): number => {
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (
  left: LegacyMarkerColor,
  right: LegacyMarkerColor
): number => {
  const [light, dark] = [luminance(left), luminance(right)].sort(
    (a, b) => b - a
  ) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

describe('marker presentation', () => {
  it('classifies only the legacy presentations', () => {
    expect(isLegacyMarkerPresentation('legacyActiveQ0')).toBe(true);
    expect(isLegacyMarkerPresentation('legacyBenchQ0')).toBe(true);
    expect(isLegacyMarkerPresentation('generic')).toBe(false);
  });

  it('puts a damage total on the biggest physical counter it reaches', () => {
    expect(
      ['10', '40', '49', '50', '90', '99', '100', '130', '9990'].map(
        damageCounterBand
      )
    ).toEqual([10, 10, 10, 50, 50, 50, 100, 100, 100]);
    expect(damageCounterBand('not a number')).toBe(10);
  });

  it('paints counters in the real accessories’ colours, growing with value', () => {
    const faces = ['20', '70', '130'].map((value) =>
      markerFace({ kind: 'damage', value })
    );
    expect(faces.map((face) => face.face)).toEqual([
      'damage-10',
      'damage-50',
      'damage-100',
    ]);
    expect(faces.map((face) => legacyMarkerCssColor(face.fill))).toEqual([
      'rgb(255, 225, 0)',
      'rgb(239, 122, 0)',
      'rgb(231, 0, 18)',
    ]);
    expect(faces.map((face) => face.fillToken)).toEqual([
      '--ptcgsim-counter-10',
      '--ptcgsim-counter-50',
      '--ptcgsim-counter-100',
    ]);
    expect(faces.map((face) => face.label)).toEqual(['20', '70', '130']);
    const [ten, fifty, hundred] = faces.map((face) => face.scale) as [
      number,
      number,
      number,
    ];
    expect(ten).toBeLessThan(fifty);
    expect(fifty).toBeLessThan(hundred);
    expect(hundred).toBeLessThanOrEqual(1);
  });

  it('reads v1 letters and words as condition chips, whatever their case', () => {
    const cases: readonly (readonly [string, string | null])[] = [
      ['P', 'poisoned'],
      ['Poisoned', 'poisoned'],
      ['b', 'burned'],
      ['Burn', 'burned'],
      ['A', 'asleep'],
      ['asleep', 'asleep'],
      ['PA', 'paralyzed'],
      ['Pa', 'paralyzed'],
      ['Paralyzed', 'paralyzed'],
      ['C', 'confused'],
      [' confused ', 'confused'],
      ['X', null],
      ['Poisoned and burned', null],
    ];
    for (const [value, kind] of cases) {
      expect(specialConditionKind(value), value).toBe(kind);
    }
  });

  it('lets the artwork carry a known condition and prints anything else', () => {
    const burned = markerFace({ kind: 'specialCondition', value: 'B' });
    expect(burned).toMatchObject({ face: 'burned', label: '', scale: 1 });
    expect(burned.art).toBeDefined();
    const note = markerFace({ kind: 'specialCondition', value: ' X ' });
    expect(note).toMatchObject({ face: 'condition-note', label: 'X' });
    // The rulebook asks for condition markers that never pass for counters.
    const counterFills = ['20', '70', '130'].map((value) =>
      legacyMarkerPackedColor(markerFace({ kind: 'damage', value }).fill)
    );
    for (const value of ['P', 'B', 'A', 'PA', 'C', 'X']) {
      const fill = markerFace({ kind: 'specialCondition', value }).fill;
      expect(counterFills, value).not.toContain(legacyMarkerPackedColor(fill));
    }
  });

  it('keeps every printed label at WCAG AA contrast on its token', () => {
    const values: readonly Pick<MarkerSceneNode, 'kind' | 'value'>[] = [
      { kind: 'damage', value: '20' },
      { kind: 'damage', value: '70' },
      { kind: 'damage', value: '130' },
      { kind: 'specialCondition', value: 'P' },
      { kind: 'specialCondition', value: 'B' },
      { kind: 'specialCondition', value: 'A' },
      { kind: 'specialCondition', value: 'PA' },
      { kind: 'specialCondition', value: 'C' },
      { kind: 'specialCondition', value: 'X' },
      { kind: 'abilityUsed', value: 'used' },
    ];
    for (const value of values) {
      const face = markerFace(value);
      expect(
        contrast(face.ink, face.fill),
        `${value.kind} ${value.value}`
      ).toBeGreaterThanOrEqual(4.5);
      // Artwork is a graphical object: WCAG 1.4.11 asks 3:1.
      if (face.art) {
        expect(
          contrast(face.art, face.fill),
          `${value.kind} ${value.value} artwork`
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('labels the ability tab like the lozenge printed on cards', () => {
    expect(markerFace({ kind: 'abilityUsed', value: 'used' })).toMatchObject({
      face: 'ability-used',
      label: 'Ability',
    });
  });

  it('shrinks labels so that four digits still fit inside the disc', () => {
    expect(markerLabelFontSizePx(30, '10')).toBeCloseTo(13.8, 10);
    expect(markerLabelFontSizePx(30, '130')).toBeCloseTo(11.4, 10);
    expect(markerLabelFontSizePx(30, '9990')).toBeCloseTo(9, 10);
    expect(markerLabelFontSizePx(30, 'Poisoned')).toBeCloseTo(4.8, 10);
    expect(markerLabelFontSizePx(30, 'a'.repeat(16))).toBeCloseTo(4.8, 10);
  });

  it('flattens a marker for renderers without artwork and for the editor', () => {
    const damage = legacyMarkerAppearance(marker());
    expect(legacyMarkerCssColor(damage.fill)).toBe('rgb(231, 0, 18)');
    expect(legacyMarkerPackedColor(damage.fill)).toBe(0xe70012);
    expect(legacyMarkerPackedColor(damage.text)).toBe(0xffffff);
    expect(damage.shape).toBe('circle');
    expect(damage.fontSizePx).toBe(markerLabelFontSizePx(30, '130'));
    expect(damage.label).toBe('130');

    const condition = legacyMarkerAppearance(
      marker({ kind: 'specialCondition', value: 'Pa' })
    );
    expect(legacyMarkerCssColor(condition.fill)).toBe('rgb(43, 43, 48)');
    expect(legacyMarkerCssColor(condition.text)).toBe('rgb(255, 214, 10)');
    // The typed value stays the text: the editor previews what is typed.
    expect(condition.label).toBe('Pa');

    for (const side of ['local', 'opponent'] as const) {
      const tab = legacyMarkerAppearance(
        marker({ kind: 'abilityUsed', value: 'used', side })
      );
      expect(tab.shape).toBe('tab');
      expect(tab.label).toBe('');
      expect(tab.fontSizePx).toBeUndefined();
      expect(legacyMarkerCssColor(tab.fill)).toBe('rgb(200, 23, 30)');
    }
  });

  it('emits rgba only for translucent colours', () => {
    expect(legacyMarkerCssColor({ r: 1, g: 2, b: 3, alpha: 1 })).toBe(
      'rgb(1, 2, 3)'
    );
    expect(legacyMarkerCssColor({ r: 1, g: 2, b: 3, alpha: 0.5 })).toBe(
      'rgba(1, 2, 3, 0.5)'
    );
  });
});
