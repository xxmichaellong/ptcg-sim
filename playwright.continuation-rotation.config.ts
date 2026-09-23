import { relative, resolve, sep } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

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

let parsedPreviewUrl: URL;
try {
  parsedPreviewUrl = new URL(previewUrl);
} catch {
  throw new Error('PTCGSIM_CONTINUATION_PREVIEW_URL must be an HTTP(S) origin');
}
if (
  (parsedPreviewUrl.protocol !== 'https:' &&
    parsedPreviewUrl.protocol !== 'http:') ||
  parsedPreviewUrl.username !== '' ||
  parsedPreviewUrl.password !== '' ||
  parsedPreviewUrl.search !== '' ||
  parsedPreviewUrl.hash !== '' ||
  (parsedPreviewUrl.pathname !== '' && parsedPreviewUrl.pathname !== '/')
) {
  throw new Error('PTCGSIM_CONTINUATION_PREVIEW_URL must be an HTTP(S) origin');
}
const loopbackHost = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']).has(
  parsedPreviewUrl.hostname
);
if (parsedPreviewUrl.protocol !== 'https:' && !loopbackHost) {
  throw new Error(
    'Managed continuation rotation requires HTTPS; HTTP is allowed only for loopback rehearsal'
  );
}

/**
 * Runs only against an explicitly supplied preview. Reports, traces, video, and
 * screenshots are disabled because an interrupted transition may still hold a
 * live continuation capability in browser memory.
 */
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'continuation-rotation.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  outputDir: 'test-results/continuation-rotation',
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: parsedPreviewUrl.origin,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env['PTCGSIM_CHROMIUM_PATH'],
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
});
