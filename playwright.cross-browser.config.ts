import { defineConfig } from '@playwright/test';

import {
  CI,
  devServers,
  lane,
  reporter,
} from './tests/browser/support/playwright-config.js';

const sharedSpecs = [
  'remote-room-solo-full-stack.spec.ts',
  'experience-refinement.spec.ts',
  'hover-preview-layering.spec.ts',
  'work-area-flight.spec.ts',
  'card-options-and-attachments.spec.ts',
  'player-name-controls.spec.ts',
  'special-card-formats.spec.ts',
  'table-depth-live.spec.ts',
  'table-depth-lab.spec.ts',
  'optimistic-feedback.spec.ts',
  'depth-recovery.spec.ts',
  'public-pile-ordering.spec.ts',
  'arrangement-visibility.spec.ts',
  'visibility-queue.spec.ts',
  'show-board-keyboard.spec.ts',
  'deck-hover-zoom.spec.ts',
  'deck-dialog-focus.spec.ts',
  'deck-quick-view.spec.ts',
  'coin-customization.spec.ts',
  'card-back-chooser-fit.spec.ts',
  'redeal-motion.spec.ts',
  'multi-select-modifiers.spec.ts',
];

/** A cross-section of the suite in Firefox and WebKit. */
export default defineConfig({
  ...lane,
  testMatch: sharedSpecs,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/cross-browser',
  reporter: reporter('playwright-report/cross-browser'),
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        launchOptions: { executablePath: process.env['PTCGSIM_FIREFOX_PATH'] },
      },
    },
    {
      name: 'webkit',
      // WebKit supports the phone contexts' touch and mobile emulation.
      testMatch: [
        ...sharedSpecs,
        'public-pile-ordering-mobile.spec.ts',
        'custom-card-dialog.spec.ts',
        'deck-landscape.spec.ts',
        'tutorial-coach-layout.spec.ts',
        'tutorial-palette-resize.spec.ts',
      ],
      use: {
        browserName: 'webkit',
        launchOptions: { executablePath: process.env['PTCGSIM_WEBKIT_PATH'] },
      },
    },
  ],
  webServer: devServers,
});
