import { defineConfig } from '@playwright/test';
import { relative, resolve, sep } from 'node:path';

import {
  chromium,
  exactOrigin,
  lane,
} from './tests/browser/support/playwright-config.js';

const previewUrl = process.env['PTCGSIM_CONTINUATION_PREVIEW_URL']?.trim();
const input = process.env['PTCGSIM_CONTINUATION_ROTATION_INPUT']?.trim();
const output = process.env['PTCGSIM_CONTINUATION_ROTATION_OUTPUT']?.trim();

if (!previewUrl) {
  throw new Error('PTCGSIM_CONTINUATION_PREVIEW_URL is required');
}
if (!input && !output) {
  throw new Error(
    'PTCGSIM_CONTINUATION_ROTATION_OUTPUT is required for capture, or PTCGSIM_CONTINUATION_ROTATION_INPUT is required for transition'
  );
}
const isInside = (candidate: string, parent: string): boolean => {
  const child = relative(parent, candidate);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`));
};
if (input && output) {
  const resolvedInput = resolve(input);
  const resolvedOutput = resolve(output);
  if (
    isInside(resolvedInput, resolvedOutput) ||
    isInside(resolvedOutput, resolvedInput)
  ) {
    throw new Error(
      'Rotation input and output directories must be distinct and non-overlapping'
    );
  }
}

/**
 * Runs only against an explicitly supplied preview. Reports, traces, video
 * and screenshots are off: an interrupted transition may still hold a live
 * continuation capability in browser memory.
 */
export default defineConfig({
  ...lane,
  testMatch: 'continuation-rotation.spec.ts',
  forbidOnly: true,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  outputDir: 'test-results/continuation-rotation',
  reporter: [['list']],
  use: {
    baseURL: exactOrigin(previewUrl, 'PTCGSIM_CONTINUATION_PREVIEW_URL'),
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [chromium],
});
