import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = join(import.meta.dirname, '..');

const stylesheets = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });

/**
 * Registered properties that inherit and are eased all the same, and why
 * that is fine: each restyles only a small subtree while it eases.
 */
const INHERITED_ON_PURPOSE: Readonly<Record<string, string>> = {
  // The pile viewer's cards read it; it eases only when the viewer is
  // resized, over the viewer's own cards.
  '--ptcgsim-zone-card-height': 'the pile viewer',
};

describe('eased custom properties', () => {
  it('never inherit, so easing one restyles only what draws it', () => {
    const sheets = stylesheets(SOURCE).map((path) => ({
      path: relative(SOURCE, path),
      css: readFileSync(path, 'utf8'),
    }));
    const inherited = sheets.flatMap(({ css }) =>
      [
        ...css.matchAll(
          /@property\s+(--[\w-]+)\s*\{[^}]*inherits:\s*true[^}]*\}/gu
        ),
      ].map((match) => match[1]!)
    );
    const eased = sheets.flatMap(({ path, css }) =>
      [...css.matchAll(/transition(?:-property)?\s*:([^;]*);/gu)].flatMap(
        (match) =>
          inherited
            .filter((name) =>
              new RegExp(`(^|[\\s,])${name}(?![\\w-])`, 'u').test(match[1]!)
            )
            .map((name) => `${name} in ${path}`)
      )
    );
    expect(
      eased.filter((each) => !(each.split(' ')[0]! in INHERITED_ON_PURPOSE))
    ).toEqual([]);
  });
});
