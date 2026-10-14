import { definePreference } from '../../preferences/preference-store.js';

/** How the player left the table's surroundings (ADR-030). */
export interface ShellPreferences {
  /**
   * The activity log stays open beside the table on a wide screen, the way
   * the old sidebar was. Narrower screens open it over the table each time.
   */
  readonly activityDocked: boolean;
  /** The empty table's welcome card was put away. */
  readonly welcomeDismissed: boolean;
  /** The app toolbar is folded into its menu button. */
  readonly toolbarCollapsed: boolean;
}

export const SHELL_PREFERENCES = definePreference<ShellPreferences>({
  key: 'ptcgsim.shell.v1',
  defaults: Object.freeze({
    activityDocked: false,
    welcomeDismissed: false,
    toolbarCollapsed: false,
  }),
  parse: (value) => {
    const field = (name: keyof ShellPreferences): boolean =>
      typeof value === 'object' &&
      value !== null &&
      Reflect.get(value, name) === true;
    return {
      activityDocked: field('activityDocked'),
      welcomeDismissed: field('welcomeDismissed'),
      toolbarCollapsed: field('toolbarCollapsed'),
    };
  },
});
