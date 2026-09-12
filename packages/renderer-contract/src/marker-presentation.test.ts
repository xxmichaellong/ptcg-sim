import { describe, expect, it } from 'vitest';

import {
  isLegacyMarkerPresentation,
  legacyMarkerAppearance,
  legacyMarkerCssColor,
  legacyMarkerPackedColor,
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

describe('legacy marker presentation', () => {
  it('classifies only the legacy presentations', () => {
    expect(isLegacyMarkerPresentation('legacyActiveQ0')).toBe(true);
    expect(isLegacyMarkerPresentation('legacyBenchQ0')).toBe(true);
    expect(isLegacyMarkerPresentation('generic')).toBe(false);
  });

  it('converts one colour definition to both renderer formats', () => {
    const damage = legacyMarkerAppearance(marker());
    expect(legacyMarkerCssColor(damage.fill)).toBe('rgb(255, 98, 0)');
    expect(legacyMarkerPackedColor(damage.fill)).toBe(0xff6200);
    expect(legacyMarkerPackedColor(damage.text)).toBe(0xffffff);
    expect(damage.shape).toBe('circle');
    expect(damage.fontSizePx).toBe(bounds.width / 2);
    expect(damage.label).toBe('130');
  });

  it('emits rgba only for translucent fills', () => {
    const tab = legacyMarkerAppearance(marker({ kind: 'abilityUsed' }));
    expect(legacyMarkerCssColor(tab.fill)).toBe('rgba(59, 141, 173, 0.708)');
    expect(legacyMarkerPackedColor(tab.fill)).toBe(0x3b8dad);
    expect(tab.fill.alpha).toBe(0.708);
  });

  it('gives each side its own ability tab and draws no glyph', () => {
    const local = legacyMarkerAppearance(marker({ kind: 'abilityUsed' }));
    const opponent = legacyMarkerAppearance(
      marker({ kind: 'abilityUsed', side: 'opponent' })
    );
    for (const tab of [local, opponent]) {
      expect(tab.shape).toBe('tab');
      expect(tab.label).toBe('');
      expect(tab.fontSizePx).toBeUndefined();
    }
    expect(legacyMarkerCssColor(opponent.fill)).toBe('rgba(255, 60, 0, 0.392)');
  });

  it('pins every special-condition swatch and its fallback', () => {
    const swatches: readonly (readonly [string, string, string])[] = [
      ['P', 'rgb(0, 128, 0)', 'rgb(255, 255, 255)'],
      ['B', 'rgb(255, 0, 0)', 'rgb(255, 255, 255)'],
      ['A', 'rgb(0, 0, 255)', 'rgb(255, 255, 255)'],
      ['PA', 'rgb(255, 255, 0)', 'rgb(0, 0, 0)'],
      ['C', 'rgb(128, 0, 128)', 'rgb(255, 255, 255)'],
      ['unknown', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)'],
    ];
    for (const [value, fill, text] of swatches) {
      const appearance = legacyMarkerAppearance(
        marker({ kind: 'specialCondition', value })
      );
      expect(legacyMarkerCssColor(appearance.fill), value).toBe(fill);
      expect(legacyMarkerCssColor(appearance.text), value).toBe(text);
      expect(appearance.fontSizePx).toBe(bounds.width * 0.75);
    }
  });

  it('matches swatches case-insensitively, as the legacy values are upper-cased', () => {
    expect(
      legacyMarkerCssColor(
        legacyMarkerAppearance(
          marker({ kind: 'specialCondition', value: 'pa' })
        ).fill
      )
    ).toBe('rgb(255, 255, 0)');
  });
});
