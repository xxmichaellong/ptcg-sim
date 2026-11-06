import type { Page } from '@playwright/test';

/**
 * Every CSS animation and transition the page starts: what it is, how long
 * it runs and the element it runs on. Recorded in the page as each one
 * starts (`animationstart`, `transitionstart`), with the element's classes
 * read at that moment, rather than by sampling frames, so a busy runner
 * (whose frames come late) cannot hide or fake one. DevTools' Animation
 * domain was read before, but it names the element only when asked
 * afterwards, and a short exit's copy was often gone by then on a loaded
 * runner, so its exit read as never played.
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

interface AnimationWatchWindow {
  __surfaceAnimations?: StartedAnimation[];
}

export const watchAnimations = async (page: Page): Promise<AnimationWatch> => {
  await page.evaluate(() => {
    const target = window as AnimationWatchWindow;
    if (target.__surfaceAnimations) return;
    target.__surfaceAnimations = [];
    /** "0.15s, 120ms" → [150, 120]. */
    const times = (value: string): number[] =>
      value.split(',').map((part) => {
        const text = part.trim();
        const number = Number.parseFloat(text);
        return text.endsWith('ms') ? number : number * 1000;
      });
    const list = (value: string): string[] =>
      value.split(',').map((part) => part.trim());
    const classOf = (element: Element): string =>
      element.getAttribute('class') ?? element.nodeName;
    document.addEventListener(
      'animationstart',
      (event) => {
        const element = event.target;
        if (!(element instanceof Element)) return;
        const style = getComputedStyle(element);
        const names = list(style.animationName);
        const durations = times(style.animationDuration);
        const index = Math.max(0, names.indexOf(event.animationName));
        target.__surfaceAnimations!.push({
          type: 'CSSAnimation',
          name: event.animationName,
          duration: Math.round(durations[index % durations.length] ?? 0),
          node: classOf(element),
        });
      },
      true
    );
    document.addEventListener(
      'transitionstart',
      (event) => {
        const element = event.target;
        if (!(element instanceof Element)) return;
        const style = getComputedStyle(element);
        const properties = list(style.transitionProperty);
        const durations = times(style.transitionDuration);
        let index = properties.indexOf(event.propertyName);
        if (index < 0) index = Math.max(0, properties.indexOf('all'));
        target.__surfaceAnimations!.push({
          type: 'CSSTransition',
          name: event.propertyName,
          duration: Math.round(durations[index % durations.length] ?? 0),
          node: classOf(element),
        });
      },
      true
    );
  });
  return {
    take: () =>
      page.evaluate(() => {
        const target = window as AnimationWatchWindow;
        const taken = target.__surfaceAnimations ?? [];
        target.__surfaceAnimations = [];
        return taken;
      }),
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
