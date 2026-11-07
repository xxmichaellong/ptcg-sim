// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import type { TutorialTarget } from './tutorial-lessons.js';
import { useTargetRects } from './TutorialSpotlight.js';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('the rings’ measurements', () => {
  it('clear when the next step points at nothing', async () => {
    const target = document.createElement('button');
    target.id = 'tutorialTarget';
    document.body.append(target);
    let seen: readonly unknown[] = [];
    const Probe = ({
      targets,
    }: {
      readonly targets: readonly TutorialTarget[];
    }) => {
      seen = useTargetRects(targets, true);
      return null;
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(<Probe targets={[{ selectors: ['#tutorialTarget'] }]} />)
    );
    expect(seen).toHaveLength(1);
    await act(async () => root.render(<Probe targets={[]} />));
    expect(seen).toEqual([]);
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });
});
