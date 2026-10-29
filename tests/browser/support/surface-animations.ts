import type { CDPSession, Page } from '@playwright/test';

/**
 * Every CSS animation and transition the page starts, as the browser's own
 * animation inspector reports it: what it is, how long it runs and the
 * element it runs on. Read from DevTools rather than by sampling frames,
 * so a busy runner (whose frames come late) cannot hide or fake one.
 */
export interface StartedAnimation {
  readonly type: string;
  /** A transition's property, or an animation's keyframes name. */
  readonly name: string;
  readonly duration: number;
  /** The element's class attribute. */
  readonly node: string;
}

export interface AnimationWatch {
  /** What has started since the last call. */
  readonly take: () => Promise<StartedAnimation[]>;
}

export const watchAnimations = async (page: Page): Promise<AnimationWatch> => {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('DOM.getDocument', { depth: 0 });
  await cdp.send('Animation.enable');
  let started: Promise<StartedAnimation>[] = [];
  cdp.on('Animation.animationStarted', ({ animation }) => {
    const backendNodeId = animation.source?.backendNodeId;
    // Described at once: a ghost is gone once its exit has played.
    started.push(
      (backendNodeId
        ? cdp
            .send('DOM.describeNode', { backendNodeId })
            .then(({ node }) => {
              const attributes = node.attributes ?? [];
              const at = attributes.indexOf('class');
              return at >= 0 ? (attributes[at + 1] ?? '') : node.nodeName;
            })
            .catch(() => '')
        : Promise.resolve('')
      ).then((node) => ({
        type: animation.type,
        name: animation.name,
        duration: animation.source?.duration ?? 0,
        node,
      }))
    );
  });
  return {
    take: async () => {
      const taken = started;
      started = [];
      return Promise.all(taken);
    },
  };
};

/** Those on an element whose class list holds every one of `classes`. */
export const on = (
  animations: readonly StartedAnimation[],
  ...classes: readonly string[]
): StartedAnimation[] =>
  animations.filter((animation) => {
    const list = animation.node.split(/\s+/u);
    return classes.every((name) => list.includes(name));
  });
